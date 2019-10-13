'use strict';
const t = require('@babel/types');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse');
const generate = require('@babel/generator').default;

const allowedIdentifiers = ['expression', 'object'];
const allowedEvalIdentifiers = ['params'];

const getConsoleStatement = (node, stateOpts, loc, nodeName, type) => {
  type = type || 'log';

  // TODO: simpler & seperate fn
  let nodeNameExpr;
  if (nodeName && nodeName.type && nodeName.type === 'ArrayExpression') {
    nodeNameExpr = nodeName;
  } else {
    if (type === 'log') {
      nodeName = nodeName || node.name || node.operator || '';
      nodeNameExpr =
        nodeName !== undefined &&
        t.arrayExpression([t.stringLiteral(nodeName)]);
    } else {
      nodeNameExpr = nodeName;
    }
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

const getSource = (path, node) => {
  if (node.end) {
    const code = path.hub.getCode();
    if (code) return code.slice(node.start, node.end);
  }

  return '';
};

const stripAssignmentExpr = name => {
  if (name.includes(':')) {
    // TODO: the same for import as alias
    const parts = name.split(':');

    return [parts[0].replace(/\s/g, ''), parts[1].replace(/\s/g, '')];
  }

  return [name];
};

const getCallExpression = (origNode, stateOpts, path, log) => {
  const identifier = path.scope.generateUidIdentifier('val');
  const { loc, type, declarations } = origNode;
  let nodeName;
  const nodeNames = [];
  const assignmentExpressions = [];

  let expression, propertyExpression, node;

  switch (type) {
    case 'ExpressionStatement':
      node = origNode.expression;
      if (node.type === 'AssignmentExpression') {
        // TODO: more than one const-vars
        nodeName = node.left.name;
      } else {
        nodeName = getSource(path, node);
      }
      nodeName = tiltName(nodeName, identifier.name);
      break;
    case 'ReturnStatement':
      // TODO: nodeName
      nodeName = '';
      node = origNode.argument;
      break;
    case 'VariableDeclaration':
      const mainDeclaration = declarations[0];

      if (mainDeclaration.id.name) {
        node = mainDeclaration.init;
        nodeName = tiltName(mainDeclaration.id.name, identifier.name);
      } else if (mainDeclaration.id.properties) {
        node = mainDeclaration.init;
        mainDeclaration.id.properties.forEach(propNode => {
          let name = getSource(path, propNode);
          let nameAlias;

          [name, nameAlias] = stripAssignmentExpr(name);

          let dottedName = `${identifier.name}.${name}`;
          assignmentExpressions.push(createExpression(dottedName));
          nodeNames.push(
            t.stringLiteral(tiltName(nameAlias || name, dottedName))
          );
        });
      }
      break;
    default:
      node = origNode;
      nodeName = tiltName(origNode.name, identifier.name);
      break;
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
          t.arrayExpression(
            (assignmentExpressions.length && assignmentExpressions) || [
              propertyExpression || identifier
            ]
          ),
          stateOpts,
          loc,
          (nodeNames.length && t.arrayExpression(nodeNames)) || nodeName
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

const unTiltName = (name, real = true) => {
  if (name.includes('~')) {
    const vals = name.split('~');
    const index = real ? 0 : 1;
    return vals[index];
  }

  return name;
};

const tiltName = (name, valName) => {
  if (name) {
    name = `${name}~${valName}`;
  }

  return name;
};

const isValOnNames = (val, names) => {
  return names.some(name => {
    name = unTiltName(name);
    name = name.split('.')[0];

    return val.name.indexOf(name) === 0;
  });
};

const checkEvaluation = (stateOpts, path, argNames, loc) => {
  const { line, rel, data } = stateOpts.toVal;

  if (line === loc.end.line && rel === stateOpts.rel) {
    const members = [];
    let names = [];

    const found = data.filter(val => {
      return isValOnNames(val, argNames);
    });

    found.forEach(item => {
      const name = item.name;
      members.push(createExpression(unTiltName(name, false)));
      names.push(t.stringLiteral(name));
    });

    const keepNames = [];
    argNames.forEach(name => {
      const exists = names.some(item => item.value === name);

      if (!exists) {
        keepNames.push(t.stringLiteral(name));
      }
    });

    names = names.concat(keepNames);

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

const getNamesFromArgs = args => {
  let names = [];

  if (args.length) {
    const argNames = args[3];

    if (argNames) {
      if (argNames.type === 'ArrayExpression') {
        names = argNames.elements.map(elem => elem.value);
      } else {
        names.push(argNames.value);
      }
    }
  }

  return names;
};

const getPropName = prop => {
  if (prop.type === 'MemberExpression') {
    return `[${getNameFromMemberExpression(prop)}]`;
  }
  return prop.name || `[${prop.value}]`;
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
    // with no arguments;
    return `${expression.callee.name}()`;
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
      return expression.name || expression.value;
  }
};

const isOnLogArgs = (stateOpts, args, callee) => {
  const { toVal } = stateOpts;

  if (toVal.data.length === 1) {
    const name = toVal.data[0].name;
    const names = getNamesFromArgs(args);
    const index = names.findIndex(key => name === key);

    if (index > -1) {
      args[0] = t.arrayExpression([args[0].elements[index]]);
      callee.property.name = 'val';

      if (names.length > 1 && index > 0) {
        // reorder elements in arrayExpression
        args[3].elements = args[3].elements.reduce(
          (entry, curr, cIndex) => {
            if (cIndex !== index) {
              entry.push(curr);
            }

            return entry;
          },
          [args[3].elements[index]]
        );
      }
    }
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
    case 'AssignmentExpression':
      source = node.left.name;
      same = source === expression;
      exprNode = node.left;
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

const getNodeString = node => {
  return generate(node).code;
};

const getBaseOfDotted = name => {
  return name.split('.')[0];
};

const referencesVisitor = {
  CallExpression(path, state) {
    const node = path.node;

    if (!node.loc) {
      return;
    }

    if (node.arguments.length && isLog(node.callee, state.opts.consoleName)) {
      const names = node.arguments[3].elements;
      const args = node.arguments[0].elements;

      names.forEach((name, key) => {
        const { value } = name;

        if (path.scope.hasReference(value)) {
          const baseCurrName = getBaseOfDotted(
            getNameFromExpression(args[key], true)
          );
          const baseName = getBaseOfDotted(value);

          if (baseCurrName !== baseName) {
            const refName = getNodeString(args[key]);
            if (value !== refName) {
              names[key] = t.stringLiteral(`${value}~${refName}`);
            }
          }
        }
      });
    }
  }
};

module.exports = {
  referencesLog() {
    return {
      name: 'references',
      visitor: {
        Program: {
          exit(path, state) {
            path.traverse(referencesVisitor, state);
          }
        }
      }
    };
  },
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
          if (!path.node.loc) {
            return;
          }

          islogEval(state.opts, path);
        },
        AssignmentExpression(path, state) {
          if (!path.node.loc) {
            return;
          }
          islogEval(state.opts, path);
        },
        CallExpression(path, state) {
          if (!path.node.loc) {
            return;
          }

          islogEval(state.opts, path);
        },
        Identifier(path, state) {
          if (!path.node.loc) {
            return;
          }

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
          // No loc(ation) for log through comments
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
              const names = getNamesFromArgs(args);

              checkEvaluation(state.opts, path, names, loc);
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
        ImportDeclaration(path, state) {
          const node = path.node;

          if (!node.loc) {
            return;
          }

          logThroughComments(node, path, state);
        },

        VariableDeclaration(path, state) {
          const node = path.node;

          if (!node.loc) {
            return;
          }

          if (node.declarations.length === 1) {
            logThroughComments(node, path, state);
          }
        },

        CallExpression(path, state) {
          const node = path.node;

          if (!node.loc) {
            return;
          }

          if (node.arguments.length && isLog(node.callee)) {
            const line = node.loc.end.line;
            const rel = state.opts.rel;
            const names = node.arguments.map(node => {
              return t.stringLiteral(getSource(path, node));
            });

            node.arguments = [
              t.arrayExpression(node.arguments),
              t.numericLiteral(line),
              t.stringLiteral(rel),
              t.arrayExpression(names)
            ];

            node.callee.object.name = state.opts.consoleName;
            return;
          }

          logThroughComments(node, path, state);
          logThroughComments(path.parent, path, state);
        },

        ReturnStatement(path, state) {
          if (!path.node.loc) {
            return;
          }

          logThroughComments(path.node, path, state);
        },
        // TODO: what we need this? will we support arr.length
        // or other member expressions without comments
        MemberExpression(path, state) {
          if (!path.node.loc) {
            return;
          }

          logThroughComments(path.node, path, state);
          if (logThroughComments(path.parent, path, state)) {
            path.skip();
          }
        },

        AssignmentExpression(path, state) {
          if (!path.node.loc) {
            return;
          }

          logThroughComments(path.node, path, state);
          if (logThroughComments(path.parent, path, state)) {
            path.skip();
          }
        },

        JSXExpressionContainer(path) {
          // TODO: check
          path.skip();
        },

        Identifier(path, state) {
          if (!allowedIdentifiers.includes(path.parentKey)) {
            return;
          }

          const node = path.node;

          if (!node.loc) {
            return;
          }

          if (
            logThroughComments(node, path, state) ||
            logThroughComments(path.parent, path, state)
          ) {
            return;
          }

          if (path.parentKey === 'expression') {
            const { loc, name } = node;

            path.replaceWith(
              getConsoleStatement(
                t.arrayExpression([node]),
                state.opts,
                loc,
                name
              )
            );
            path.skip();
          }
        },

        BinaryExpression(path, state) {
          // TODO: will keep this?
          if (path.parentKey === 'expression') {
            const node = path.node;

            if (!node.loc) {
              return;
            }

            path.replaceWith(
              getConsoleStatement(
                t.arrayExpression([node]),
                state.opts,
                node.loc,
                node.operator
              )
            );
          }
        }
      }
    };
  }
};
