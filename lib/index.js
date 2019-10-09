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

const getNameFromMemberExpression = (
  expression,
  returnDotted = false,
  callExpr
) => {
  let properties = [getPropName(expression.property)];
  properties[0] = callExpr ? `${properties[0]}()` : properties[0];
  let object = expression.object;

  if (object.type === 'CallExpression') {
    properties.unshift(getNameFromCallExpression(object));
  } else {
    while (object.type === 'MemberExpression') {
      properties.unshift(getPropName(object.property));
      object = object.object;
    }

    if (object.type === 'CallExpression') {
      properties.unshift(getNameFromCallExpression(object));
    } else {
      properties.unshift(object.name);
    }
  }

  let dotted = properties.join('.').replace(/\.[[]/g, '[');
  if (returnDotted) {
    return dotted;
  } else {
    return createExpression(dotted);
  }
};

const getNameFromCallExpression = expression => {
  if (expression.callee.type === 'Identifier') {
    const args = getNodeNames(expression, false, false);
    if (args.length) {
      return `${expression.callee.name}('${args[0]}')`;
    } else {
      return `${expression.callee.name}()`;
    }
  } else {
    return getNameFromMemberExpression(expression.callee, true, true);
  }
};

const getNameFromExpression = (expression, returnDotted = false) => {
  const { type } = expression;

  switch (type) {
    case 'CallExpression':
      return getNameFromCallExpression(expression);
    case 'MemberExpression':
      return getNameFromMemberExpression(expression, returnDotted);
    default:
      break;
  }
};

const getCallExpression = (origNode, stateOpts, path, log) => {
  const identifier = path.scope.generateUidIdentifier('val');
  const { loc, type, declarations } = origNode;
  let nodeName;

  let expression, propertyExpression, node;

  if (type === 'ExpressionStatement') {
    node = origNode.expression;
    nodeName = getNameFromExpression(node, true);
  } else if (type === 'ReturnStatement') {
    node = origNode.argument;
  } else if (type === 'VariableDeclaration') {
    node = declarations[0].init;
    nodeName = declarations[0].id.name;
  } else {
    node = origNode;
    nodeName = origNode.name;
  }

  // used during evaluation
  if (nodeName) {
    nodeName = `${nodeName}~~${identifier.name}`;
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

const createExpression = dotted => {
  if (!dotted.includes('.')) {
    return t.identifier(dotted);
  }

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
    return `[${getNameFromMemberExpression(prop)}]`;
  }
  return prop.name || `[${prop.value}]`;
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
  return isLog(callee, name, 'val') || isLogVal(callee, name);
};

const isLogVal = (callee, name) => {
  return isLog(callee, name, 'logVal');
};

const checkEvaluation = (stateOpts, path, argsName, loc) => {
  const { line, rel, data } = stateOpts.toVal;
  const rootArgName = argsName.split('.')[0];

  if (line === loc.end.line && rel === stateOpts.rel) {
    const members = [];
    const names = [];

    const found = data.filter(val => {
      return val.name.indexOf(rootArgName) === 0;
    });

    found.forEach(item => {
      const name = item.name;
      members.push(createExpression(name));
      names.push(t.stringLiteral(name));
    });

    if (found.length) {
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

      stateOpts.toVal.data = data.filter(item => {
        return !found.some(elem => elem.name === item.name);
      });
    }

    if (stateOpts.toVal.data.length === 0) {
      stateOpts.toVal = null;
    }
  }
};

const getFirstArgName = args => {
  let argName = '';

  if (args.length) {
    const names = args[3];

    if (names) {
      if (names.type === 'ArrayExpression') {
        const elem = names.elements[0];
        argName = elem.value;
      } else {
        //stringliteral
        argName = names.value;
      }
    }
  }

  return argName;
};

const isOnLogArgs = (stateOpts, args, callee) => {
  const { toVal } = stateOpts;

  if (toVal.data.length === 1) {
    const name = toVal.data[0].name;
    const logArgName = getFirstArgName(args);

    if (logArgName === name) {
      args[0] = t.arrayExpression([args[0]]);
      callee.property.name = 'val';
    }
  }
};

const getNodeNames = (node, isVal, typed = true) => {
  return node.arguments.map(argument => {
    let name;

    switch (argument.type) {
      case 'CallExpression':
        name = getNameFromCallExpression(argument);
        break;
      case 'MemberExpression':
        name = getNameFromMemberExpression(argument, true);
        break;
      case 'ArrayExpression':
        name = '';
        if (isVal) {
          const firstElem = argument.elements[0];
          if (firstElem.type === 'MemberExpression') {
            name = getNameFromMemberExpression(firstElem, true);
          } else if (firstElem.type === 'Identifier') {
            name = firstElem.name;
          } else if (firstElem.type === 'StringLiteral') {
            name = firstElem.value;
          }
        }
        break;
      /* case 'BooleanLiteral':
        name = argument.value */
      default:
        name = argument.name || argument.value || '';
        break;
    }

    if (typed) {
      if (typeof name === 'number') {
        return t.numericLiteral(name);
      }

      return t.stringLiteral(name);
    } else {
      return name;
    }
  });
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
          if (same) {
            data[key].exprNode = exprNode;
          }

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

            if (hasLog) {
              isOnLogArgs(state.opts, args, callee);
            } else if (hasVal) {
              const name = getFirstArgName(args);
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
            const names = getNodeNames(node);

            node.arguments.push(
              t.numericLiteral(line),
              t.stringLiteral(rel),
              t.arrayExpression(names)
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
