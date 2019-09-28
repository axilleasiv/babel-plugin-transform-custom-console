'use strict';

const t = require('@babel/types');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse');
const allowedIdentifiers = ['expression', 'object'];
const allowedEvalIdentifiers = ['params'];

const getConsoleStatement = (node, stateOpts, loc, nodeName, type) => {
  type = type || 'log';
  let nodeNameExpr;
  if (type === 'log') {
    nodeName = nodeName || node.name || node.operator || '';
    nodeNameExpr = nodeName && t.stringLiteral(nodeName);
  } else {
    nodeNameExpr = nodeName;
  }

  const callExpression = t.callExpression(
    t.memberExpression(t.identifier(stateOpts.consoleName), t.identifier(type)),
    [
      node,
      t.numericLiteral(loc.end.line || node.loc.end.line),
      t.stringLiteral(stateOpts.rel),
      nodeNameExpr
    ]
  );

  const location = loc || node.loc;
  callExpression.loc = location;

  return t.expressionStatement(callExpression);
};

const getCallExpression = (origNode, stateOpts, path, log) => {
  const identifier = path.scope.generateUidIdentifier('val');
  const { loc, type, declarations } = origNode;
  let nodeName;

  let expression, propertyExpression, node;

  if (type === 'ExpressionStatement') {
    node = origNode.expression;
  } else if (type === 'ReturnStatement') {
    node = origNode.argument;
  } else if (type === 'VariableDeclaration') {
    node = declarations[0].init;
    nodeName = declarations[0].id.name;
  } else {
    node = origNode;
    nodeName = origNode.name;
  }

  // TODO: test for callExpressions
  if (log && log.type === 'log') {
    if (log.inExpression) {
      propertyExpression = t.memberExpression(
        identifier,
        t.identifier(log.property)
      );
    } else {
      try {
        propertyExpression = parser.parse(log.property);
        traverse.default.removeProperties(propertyExpression);
        if (propertyExpression.program.body.length) {
          propertyExpression = propertyExpression.program.body[0].expression;
        } else {
          propertyExpression = undefined;
        }
      } catch (err) {
        // TODO: err
        propertyExpression = undefined;
      }
    }
  }

  expression = t.callExpression(
    t.functionExpression(
      null,
      [],
      t.blockStatement([
        t.variableDeclaration('var', [t.variableDeclarator(identifier, node)]),
        getConsoleStatement(
          propertyExpression || identifier,
          stateOpts,
          loc,
          nodeName
        ),
        t.returnStatement(identifier)
      ])
    ),
    []
  );

  if (type === 'ReturnStatement') {
    expression = t.returnStatement(expression);
  } else if (type === 'VariableDeclaration') {
    origNode.declarations[0].init = expression;
    return origNode;
  }

  expression.loc = origNode.loc;

  return expression;
};

const isExpression = comment => {
  return comment.charAt(0) === '=';
};

const hasLogExpression = node => {
  return (
    node.trailingComments &&
    node.trailingComments.length &&
    isExpression(node.trailingComments[0].value)
  );
};

const getExpression = comment => {
  comment = comment.replace(/\s/g, '').slice(1);

  if (comment !== '' && comment.length > 2) {
    if (comment.indexOf('$.') !== -1) {
      const property = comment.split('$.')[1];

      return {
        type: 'log',
        property: property,
        inExpression: true
      };
    }

    return {
      type: 'log',
      property: comment
    };
  }

  return {
    type: 'result'
  };
};

const getIdentifier = property => {
  return t.identifier(property);
};

const isComputed = property => {
  const propInt = parseInt(property);
  return !Number.isNaN(propInt);
};

const createMemberExpression = dotted => {
  dotted = dotted.split('.');
  let memberExpression = t.memberExpression(
    getIdentifier(dotted[0]),
    getIdentifier(dotted[1]),
    isComputed(dotted[1])
  );
  const arr = dotted.slice(2);

  while (arr.length) {
    const property = arr.shift();
    memberExpression = t.memberExpression(
      memberExpression,
      getIdentifier(property),
      isComputed(property)
    );
  }

  return memberExpression;
};

const getPropName = prop => {
  if (prop.type === 'MemberExpression') {
    return `[${getNameFromExpression(prop)}]`;
  }
  return prop.name || `[${prop.value}]`;
};

const getNameFromExpression = expression => {
  const properties = [getPropName(expression.property)];
  let object = expression.object;

  while (object.type === 'MemberExpression') {
    properties.unshift(getPropName(object.property));
    object = object.object;
  }

  properties.unshift(object.name);
  return properties.join('.').replace(/\.[[]/g, '[');
};

const checkComments = node => {
  if (hasLogExpression(node)) {
    const comment = node.trailingComments[0].value;
    const expression = getExpression(comment);

    node.trailingComments = [];

    return expression;
  }

  return false;
};

const logThroughComments = (node, path, state) => {
  const log = checkComments(node);

  if (log) {
    path.replaceWith(getCallExpression(node, state.opts, path, log));

    return true;
  }

  return false;
};

const isLog = (callee, name = 'console', property = 'log') => {
  if (
    callee.object &&
    callee.object.name === name &&
    callee.property &&
    callee.property.name === property
  ) {
    return true;
  }

  return false;
};

const isVal = (callee, name) => {
  return isLog(callee, name, 'val');
};

const isLogVal = (callee, name) => {
  return isLog(callee, name, 'logVal');
};

const checkEvaluation = (stateOpts, path, name, loc) => {
  const { line, rel, data } = stateOpts.toVal;

  if (line === loc.end.line && rel === stateOpts.rel) {
    const members = [];
    const names = [];

    data
      .filter(val => {
        return val.name.indexOf(name) === 0;
      })
      .forEach(item => {
        const name = item.name;
        members.push(createMemberExpression(name));
        names.push(t.stringLiteral(name));
      });

    if (members.length && names.length) {
      t.arrayExpression(members);
      t.arrayExpression(names);

      const expression = getConsoleStatement(
        t.arrayExpression(members),
        stateOpts,
        loc,
        t.arrayExpression(names),
        'val'
      );

      path.replaceWith(expression);
    }

    stateOpts.toVal.data = data.filter(val => {
      return !(val.name.indexOf(name) === 0);
    });

    if (stateOpts.toVal.data.length === 0) {
      stateOpts.toVal = null;
    }
  }
};

const getNodeName = (node, isVal) => {
  const firstArg = node.arguments[0];

  if (firstArg.type === 'MemberExpression') {
    return getNameFromExpression(firstArg);
  } else if (isVal && firstArg.type === 'ArrayExpression') {
    const firstElem = firstArg.elements[0];
    if (firstElem.type === 'MemberExpresssion') {
      return getNameFromExpression(firstElem);
    }

    return '';
  } else {
    return firstArg.name || '';
  }
};

// TODO: you can add an extra argument to old logEval in order to keep this for evaluation
const checkForPreviousLogs = (path, node, stateOpts) => {
  const { callee, arguments: args, loc, type } = node;
  if (type === 'CallExpression') {
    if (isLogVal(callee, stateOpts.consoleName)) {
      const added = stateOpts.toVal.added.filter(
        item => item.line === loc.end.line
      );

      if (added.length) {
        const found = added.some(item => item.exprNode === args[0]);

        if (!found) {
          path.remove();
          return true;
        }
      } else {
        path.remove();
        return true;
      }
    }
  }

  return false;
};

const checkSourceExpr = (node, path, expression) => {
  const { type } = node;
  let same = false;
  let source, exprNode;

  switch (type) {
    case 'Identifier':
      source = node.name;
      same = source === expression;
      exprNode = node;
      break;
    case 'VariableDeclaration':
      source = node.declarations[0].id.name;
      same = source === expression;
      exprNode = node.declarations[0].id;
      break;
    case 'CallExpression':
      source = path.getSource();
      same = expression.includes(source);
      exprNode = node;
      break;
    default:
      break;
  }

  return { same, exprNode };
};

const islogEval = (stateOpts, path) => {
  if (stateOpts.toVal) {
    const { node } = path;
    const { loc, type } = node;

    if (loc) {
      const data = stateOpts.toVal.data;
      if (data.length) {
        const found = data.filter((val, key) => {
          const { line, expression, rel } = val;
          const { same, exprNode } = checkSourceExpr(node, path, expression);
          // instead to use map again
          data[key].exprNode = exprNode;

          return line === loc.start.line && rel === stateOpts.rel && same;
        });

        found.forEach(item => {
          const { line, expression, exprNode } = item;
          const logExpr = getConsoleStatement(
            exprNode,
            stateOpts,
            {
              start: {
                line,
                column: 0
              },
              end: {
                line,
                column: 0
              }
            },
            t.stringLiteral(expression),
            'logVal'
          );

          if (type === 'Identifier') {
            const parent = path.parent;
            if (parent.body && parent.body.type === 'BlockStatement') {
              const body = parent.body.body;
              const lastIndex = body
                .map(item => {
                  if (
                    item.type === 'ExpressionStatement' &&
                    item.expression.callee &&
                    isLogVal(item.expression.callee, stateOpts.consoleName)
                  ) {
                    return 1;
                  } else {
                    return 0;
                  }
                })
                .lastIndexOf(1);

              if (lastIndex > -1) {
                body.splice(lastIndex + 1, 0, logExpr);
              } else {
                body.unshift(logExpr);
              }
            }
          } else {
            path.insertAfter(logExpr);
          }

          stateOpts.toVal.added.push({
            line,
            exprNode
          });
        });

        if (found.length) {
          stateOpts.toVal.data = data.filter(val => {
            const { line, rel, expression } = val;

            return !found.some(item => {
              return (
                line === item.line &&
                rel === item.rel &&
                expression === item.expression
              );
            });
          });
        }
      }

      if (checkForPreviousLogs(path, node, stateOpts)) {
        return true;
      }
    }

    return true;
  }

  return false;
};

module.exports = {
  evaluationLog() {
    return {
      name: 'evaluationLog',
      visitor: {
        Program: {
          enter(path, state) {
            if (state.opts.toVal) {
              state.opts.toVal.added = [];
            }
          },
          exit(path, state) {
            if (state.opts.toVal) {
              state.opts.toVal = null;
            }
          }
        },
        VariableDeclaration(path, state) {
          islogEval(state.opts, path);
        },
        CallExpression(path, state) {
          islogEval(state.opts, path);
        },
        Identifier(path, state) {
          // TODO: if node.name = cov_jbjx08c0d etc;
          if (!allowedEvalIdentifiers.includes(path.parentKey)) {
            return;
          }

          islogEval(state.opts, path);
        }
      }
    };
  },
  evaluation() {
    return {
      name: 'evaluation',
      visitor: {
        Program: {
          exit(path, state) {
            if (state.opts.toVal) {
              state.opts.toVal = null;
            }
          }
        },
        CallExpression(path, state) {
          if (!state.opts.toVal) {
            return;
          }

          const node = path.node;
          const { callee, arguments: args, loc } = node;
          const { consoleName } = state.opts;
          if (args.length) {
            const hasLog = isLog(callee, consoleName);
            const hasVal = isVal(callee, consoleName);

            if (hasLog || hasVal) {
              const name = getNodeName(node, hasVal);

              checkEvaluation(state.opts, path, name, loc);
            }
          }
        }
      }
    };
  },
  logger() {
    return {
      name: 'logger',
      visitor: {
        VariableDeclaration(path, state) {
          const node = path.node;
          if (node.declarations.length === 1) {
            logThroughComments(node, path, state);
          }
        },

        CallExpression(path, state) {
          const node = path.node;

          if (node.arguments.length && isLog(node.callee)) {
            const line = node.loc.end.line;
            const rel = state.opts.rel;
            const name = getNodeName(node);

            node.arguments.push(
              t.numericLiteral(line),
              t.stringLiteral(rel),
              t.stringLiteral(name)
            );

            node.callee.object.name = state.opts.consoleName;

            return;
          }

          logThroughComments(node, path, state);
          logThroughComments(path.parent, path, state);
        },

        ReturnStatement(path, state) {
          logThroughComments(path.node, path, state);
        },
        // TODO: what we need this? will we support arr.length
        // or other member expressions without comments
        MemberExpression(path, state) {
          logThroughComments(path.node, path, state);
          if (logThroughComments(path.parent, path, state)) {
            path.skip();
          }
        },

        Identifier(path, state) {
          // TODO: if node.name = cov_jbjx08c0d etc;
          if (!allowedIdentifiers.includes(path.parentKey)) {
            return;
          }

          const node = path.node;

          if (
            logThroughComments(node, path, state) ||
            logThroughComments(path.parent, path, state)
          ) {
            return;
          }

          if (path.parentKey === 'expression') {
            const { loc, name } = node;

            path.replaceWith(getConsoleStatement(node, state.opts, loc, name));
            path.skip();
          }
        },

        BinaryExpression(path, state) {
          // TODO: will keep this?
          if (path.parentKey === 'expression') {
            const node = path.node;
            path.replaceWith(getConsoleStatement(node, state.opts, node.loc));
          }
        }
      }
    };
  }
};
