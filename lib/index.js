'use strict';
const t = require('@babel/types');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse');
const generate = require('@babel/generator').default;

const allowedIdentifiers = ['expression', 'object'];
const allowedEvalIdentifiers = ['params'];

const getConsoleStatement = (logsExpr, stateOpts, loc, namesExpr, type) => {
  type = type || 'log';

  const callExpression = t.callExpression(
    t.memberExpression(t.identifier(stateOpts.consoleName), t.identifier(type)),
    [
      logsExpr,
      t.numericLiteral(loc.end.line || logsExpr.loc.end.line),
      t.stringLiteral(stateOpts.rel),
      namesExpr
    ]
  );

  const location = loc || logsExpr.loc;
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
    const parts = name.split(':');

    return [parts[0].replace(/\s/g, ''), parts[1].replace(/\s/g, '')];
  }

  return [name];
};

const getDetailsFromAssignmentExpr = (properties, idName, path) => {
  const expressions = [];
  const names = [];

  properties.forEach(propNode => {
    let name = getSource(path, propNode);
    let nameAlias;

    [name, nameAlias] = stripAssignmentExpr(name);

    let dottedName = `${idName}.${name}`;
    expressions.push(createExpression(dottedName));
    names.push(t.stringLiteral(tiltName(nameAlias || name, dottedName)));
  });

  return [expressions, names];
};

const getCallExpression = (origNode, stateOpts, path, log) => {
  const identifier = path.scope.generateUidIdentifier('val');
  const { loc, type, declarations } = origNode;
  const { type: logType } = log;

  let logNames = [];
  let logExpressions = [];
  let replace = true;
  let expression, propertyExpression, node, nodeName;

  switch (type) {
    case 'ExpressionStatement':
      node = origNode.expression;

      if (node.type === 'AssignmentExpression') {
        if (node.left.name) {
          nodeName = node.left.name;
        } else if (node.left.properties) {
          [logExpressions, logNames] = getDetailsFromAssignmentExpr(
            node.left.properties,
            identifier.name,
            path
          );
        }
      } else {
        nodeName = getSource(path, node);
      }
      nodeName = tiltName(nodeName, identifier.name);
      break;
    case 'ReturnStatement':
      node = origNode.argument;
      nodeName = getSource(path, node);
      nodeName = tiltName(nodeName, identifier.name);
      break;
    case 'ImportDeclaration':
      node = origNode;

      if (node.specifiers.length) {
        node.specifiers.forEach(specifier => {
          const { local } = specifier;

          if (local) {
            logExpressions.push(local);
            logNames.push(t.stringLiteral(local.name));
          }
        });

        replace = false;
      } else {
        nodeName = getSource(path, node);
        nodeName = tiltName(nodeName, identifier.name);
        node = t.callExpression(t.import(), [node.source]);
      }
      break;
    case 'VariableDeclaration':
      const mainDeclaration = declarations[0];

      if (mainDeclaration.id.name) {
        node = mainDeclaration.init;
        nodeName = tiltName(mainDeclaration.id.name, identifier.name);
      } else if (mainDeclaration.id.properties) {
        node = mainDeclaration.init;
        [logExpressions, logNames] = getDetailsFromAssignmentExpr(
          mainDeclaration.id.properties,
          identifier.name,
          path
        );
      }
      break;
    default:
      node = origNode;
      nodeName = getSource(path, node);
      nodeName = tiltName(nodeName, identifier.name);
      break;
  }

  // expression inside comments
  //TODO: add log property to name of logs
  if (logType === 'log') {
    if (log.asDollarExpr) {
      propertyExpression = t.memberExpression(
        identifier,
        t.identifier(log.property)
      );
    } else {
      try {
        //TODO: maybe createExpression can work instead of parse
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

  if (!logNames.length) {
    // TODO: simpler also, in logNames inside do the same;
    /* nodeName = nodeName.replace(/(\/\*([\s\S]*?)\*\/)|(\/\/(.*)$)/gm, '');
    nodeName = nodeName.split(/\r\n|\n|\\n/).join('');
    nodeName = nodeName.replace(/\s\s\s\s/g, '');
    nodeName = nodeName.replace(/\s\s/g, ''); */

    logNames.push(t.stringLiteral(nodeName));
  }

  const consoleLog = getConsoleStatement(
    t.arrayExpression(
      (logExpressions.length && logExpressions) || [
        propertyExpression || identifier
      ]
    ),
    stateOpts,
    loc,
    t.arrayExpression(logNames)
  );

  if (replace) {
    expression = t.callExpression(
      t.functionExpression(
        null,
        [],
        t.blockStatement([
          t.variableDeclaration('var', [
            t.variableDeclarator(identifier, node)
          ]),
          consoleLog,
          t.returnStatement(identifier)
        ])
      ),
      []
    );

    if (type === 'ReturnStatement') {
      expression = t.returnStatement(expression);
    } else if (type === 'VariableDeclaration') {
      origNode.declarations[0].init = expression;
      expression = origNode;
    }
  } else {
    expression = consoleLog;
  }

  expression.loc = origNode.loc;

  return {
    expression,
    replace
  };
};

const isExpression = comment => {
  return comment.charAt(0) === '=';
};

const hasLogExpression = node => {
  if (
    node.trailingComments &&
    node.trailingComments.length &&
    isExpression(node.trailingComments[0].value)
  ) {
    return { value: node.trailingComments[0].value };
  }

  return false;
};

const checkComments = node => {
  let comment;
  if ((comment = hasLogExpression(node))) {
    const { value } = comment;
    const expression = getExpression(value);

    node.trailingComments = [];

    return expression;
  }

  return false;
};

const logThroughComments = (node, path, state) => {
  const log = checkComments(node);

  if (log) {
    const { replace, expression } = getCallExpression(
      node,
      state.opts,
      path,
      log
    );

    if (replace) {
      path.replaceWith(expression);
    } else {
      path.insertAfter(expression);
    }

    return true;
  }

  return false;
};

const getExpression = comment => {
  comment = comment.replace(/\s/g, '').slice(1);

  if (comment !== '' && comment.length > 2) {
    if (comment.indexOf('$.') !== -1) {
      const property = comment.split('$.')[1];

      return {
        type: 'log',
        property: property,
        asDollarExpr: true
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
        const found = added.some(item => item.exprNode === args[0].elements[0]);

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

const getValOnAssignment = (properties, expression, path) => {
  let same = false;
  let exprNode;

  const index = properties.findIndex(propNode => {
    let name = getSource(path, propNode);
    let nameAlias;

    [name, nameAlias] = stripAssignmentExpr(name);

    if (nameAlias && nameAlias === expression) {
      return true;
    } else if (!nameAlias && name === expression) {
      return true;
    }

    return false;
  });

  if (index > -1) {
    same = true;
    exprNode = properties[index].value;
  }

  return {
    same,
    exprNode
  };
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
      const mainDeclaration = node.declarations[0];

      if (mainDeclaration.id.name) {
        source = mainDeclaration.id.name;
        same = source === expression;
        exprNode = mainDeclaration.id;
      } else if (mainDeclaration.id.properties) {
        ({ same, exprNode } = getValOnAssignment(
          mainDeclaration.id.properties,
          expression,
          path
        ));
      }
      break;
    case 'AssignmentExpression':
      if (node.left.name) {
        source = node.left.name;
        same = source === expression;
        exprNode = node.left;
      } else if (node.left.properties) {
        ({ same, exprNode } = getValOnAssignment(
          node.left.properties,
          expression,
          path
        ));
      }
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
            t.arrayExpression([exprNode]),
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
            t.arrayExpression([t.stringLiteral(expression)]),
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
        // TODO: ImportDeclaration

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

        ExpressionStatement(path, state) {
          if (!path.node.loc) {
            return;
          }

          logThroughComments(path.node, path, state);
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
          }

          logThroughComments(node, path, state);
          // logThroughComments(path.parent, path, state);
        },

        ReturnStatement(path, state) {
          if (!path.node.loc) {
            return;
          }

          logThroughComments(path.node, path, state);
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
                t.arrayExpression([t.stringLiteral(name || '')])
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
                t.arrayExpression([t.stringLiteral(node.operator)])
              )
            );
          }
        }
      }
    };
  }
};
