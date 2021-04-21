'use strict';
const t = require('@babel/types');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse');
const generate = require('@babel/generator').default;

const allowedIdentifiers = ['expression', 'object'];
const allowedEvalIdentifiers = ['params'];
const PERF_MARK = 'perfMark';
const PERF_MEASURE = 'perfMeasure';

const uuid = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
};

const prepareLoc = (location, extra) => {
  const endLine = t.numericLiteral(location.end.line);
  const startLine = t.numericLiteral(location.start.line);
  let arr = [t.arrayExpression([startLine, endLine])];

  if (extra) {
    arr = arr.concat(extra);
  }

  return t.arrayExpression(arr);
};

const getConsoleStatement = (
  logsExpr,
  stateOpts,
  loc,
  namesExpr,
  type,
  extraLoc
) => {
  type = type || 'log';

  const location = loc || logsExpr.loc;
  const consoleArgs = [
    logsExpr,
    prepareLoc(location, extraLoc),
    t.stringLiteral(stateOpts.doc.rel),
    namesExpr,
    t.numericLiteral(stateOpts.doc.idx)
  ];

  const callExpression = t.callExpression(
    t.memberExpression(t.identifier(stateOpts.consoleName), t.identifier(type)),
    consoleArgs
  );

  callExpression.loc = location;

  return t.expressionStatement(callExpression);
};

const getPerfExpression = (stateOpts, location, names) => {
  const measure = names.length > 1;
  const identifier = measure ? PERF_MEASURE : PERF_MARK;

  let args = names.map(name => name ? t.stringLiteral(name) : t.nullLiteral());

  if (measure) {
    args  = [
      t.arrayExpression(args),
      prepareLoc(location),
      t.stringLiteral(stateOpts.doc.rel),
      t.numericLiteral(stateOpts.doc.idx)
    ];
  }


  const callExpression = t.callExpression(
    t.memberExpression(t.identifier(stateOpts.consoleName), t.identifier(identifier)),
    args,
  );

  return t.expressionStatement(callExpression);
}

const getDetectLoopStatement = (
  stateOpts,
  location,
) => {
  const type = 'detectLoop';
  const endLine = t.numericLiteral(location.end.line);
  const startLine = t.numericLiteral(location.start.line);
  const locationArgument = t.arrayExpression([startLine, endLine]);
  const args = [
    locationArgument,
    t.stringLiteral(stateOpts.doc.rel),
    t.numericLiteral(stateOpts.doc.idx)
  ];

  const callExpression = t.callExpression(
    t.memberExpression(t.identifier(stateOpts.consoleName), t.identifier(type)),
    args
  );

  callExpression.loc = location;

  return t.expressionStatement(callExpression);
};

const getSource = (path, node) => {
  if (node.end) {
    let code;
    if (path.hub.getCode) {
      code = path.hub.getCode();
    } else if (path.hub.file.code) {
      code = path.hub.file.code;
    }

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

const stripParen = name => {
  return name.replace(/\((.*?)\)/, '');
};

const stripCommentsAndLines = name => {
  name = name.replace(/(\/\*([\s\S]*?)\*\/)|(\/\/(.*)$)/gm, '');
  name = name.split(/\r\n|\n|\\n/).join('');
  name = name.replace(/\s\s\s\s/g, '');
  name = name.replace(/\s\s/g, '');
  return name;
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

const isAllowedLoc = (loc, state) => {
  if (!loc) {
    return false;
  }

  const { offsetLines } = state;
  if (offsetLines.length) {
    const [min, max] = offsetLines;
    if (loc.start.line < min || loc.start.line > max) {
      return false;
    }
  }

  return true;
};

const getLocArrExpr = (start, end) => {
  return t.arrayExpression([t.numericLiteral(start), t.numericLiteral(end)]);
};

const getReferences = (exprPath, name, propName) => {
  let locations = [];
  let offsetLines = [];

  if (!name) {
    return locations;
  }

  const parts = name.split('.');

  const bindings = exprPath.scope.bindings;
  const callInScope = bindings[parts[0]];

  if (callInScope) {
    let path;
    if (parts.length > 1) {
      let exprs;
      ({ path } = callInScope);

      if (path.type === 'VariableDeclarator') {
        if ((exprs = path.get('init.expressions'))) {
          if (exprs.node) {
            exprs = exprs.filter(expr => {
              return expr.node.loc;
            });
          }
        }
      } else if (path.type === 'FunctionDeclaration') {
        path = path.get('body');
      }

      if (exprs && exprs.length) {
        if (exprs.length === 1) {
          path = exprs[0];

          const propertyName = parts[parts.length - 1];
          const { node } = path;
          let { loc } = node;

          switch (path.type) {
            case 'ObjectExpression':
              // TODO: add code for complex case
              node.properties.some(prop => {
                const arg = prop.key || prop.argument;

                if (arg.name === propertyName) {
                  if (prop.body) {
                    loc = prop.body.loc;
                  } else {
                    loc = prop.value ? prop.value.loc : arg.loc || prop.loc;
                  }
                  return true;
                }

                return false;
              });

              offsetLines = [loc.start.line, loc.end.line];
              locations.push(getLocArrExpr(offsetLines[0], offsetLines[1]));
              break;
            case 'NewExpression':
              locations.push(getLocArrExpr(loc.start.line, loc.end.line));

              const callLocations = getReferences(
                exprPath,
                node.callee.name,
                propertyName
              );
              locations = locations.concat(callLocations);
              break;

            default:
              break;
          }
        }
      }
    } else {
      ({ path } = callInScope);
      let { loc } = path.node;

      switch (path.type) {
        case 'ClassDeclaration':
          const body = path.node.body.body;
          body.some(prop => {
            if (prop.key.type === 'Identifier' && prop.key.name === propName) {
              loc = prop.loc;
              return true;
            }

            return false;
          });
          break;
        default:
          break;
      }

      locations.push(getLocArrExpr(loc.start.line, loc.end.line));
    }

    if (callInScope.referenced) {
      path.traverse(
        {
          CallExpression(path, state) {
            const { node } = path;

            if (!isAllowedLoc(node.loc, state)) {
              return;
            }

            const name = getNameFromExpression(node.callee, true, false);
            const callLocations = getReferences(path, name);
            locations = locations.concat(callLocations);
          },
          NewExpression(path, state) {
            const { node } = path;

            if (!isAllowedLoc(node.loc, state)) {
              return;
            }

            const callLocations = getReferences(path, node.callee.name);
            locations = locations.concat(callLocations);
          },
          ObjectProperty(path) {
            path.skip();
          },
          Identifier(path, state) {
            const { node } = path;

            if (
              !isAllowedLoc(node.loc, state) ||
              !['argument', 'arguments', 'value'].includes(path.parentKey)
            ) {
              return;
            }

            const { name: idName } = node;
            if (name !== idName) {
              if (bindings[idName]) {
                const callLocations = getReferences(path, idName);
                locations = locations.concat(callLocations);
              }
            }
          }
        },
        { offsetLines }
      );
    }
  }

  return locations;
};

const isAsyncExpression = (expression) => {
  return expression && expression.type === 'AwaitExpression';
}

const isAsyncLog = (node) => {
  if (node.expressions) {
    return node.expressions.some(isAsyncExpression);
  }

  return false;
}

const getCallExpression = (origNode, stateOpts, path, log) => {
  const identifier = path.scope.generateUidIdentifier('val');
  const { loc, type, declarations } = origNode;
  const { type: logType } = log;
  let extraLoc;

  let logNames = [];
  let logExpressions = [];
  let replace = true;
  let async = false;
  let expression, propertyExpression, node, nodeName;

  switch (type) {
    case 'ExpressionStatement':
      node = origNode.expression;

      let name = getNameFromExpression(node, true, false);
      if (name) {
        extraLoc = getReferences(path, name);
      }

      if (node.type === 'AssignmentExpression') {
        async = isAsyncExpression(node.right);

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
        async =  isAsyncLog(node);
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
  if (logType === 'log') {
    if (log.asDollarExpr) {
      propertyExpression = t.memberExpression(
        identifier,
        t.identifier(log.property)
      );

      // TODO: add log property to name of logs
      if (nodeName) {
        const parts = nodeName.split('~');
        nodeName = `${parts[0]}.${log.property}~${parts[1]}`;
      }
    } else {
      try {
        // TODO: maybe createExpression can work instead of parse
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
    nodeName = stripCommentsAndLines(nodeName);
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
    t.arrayExpression(logNames),
    'log',
    extraLoc
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
        ]),
        false, //generator
        async, // async
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

const isCommentLog = comment => {
  return comment.charAt(0) === '=';
};

const isPerfLog = comment => {
  return comment.charAt(0) === '?';
};

const hasLogExpression = node => {
  if (
    node.trailingComments &&
    node.trailingComments.length
  ) {
    const { value } = node.trailingComments[0];

    if (isCommentLog(value)) {
      return { value, type: 'log' };
    } else if (isPerfLog(value)) {
      return { value, type: 'perf' };
    }

  }

  return false;
};

const checkComments = (node, stateOpts) => {
  let comment;
  if ((comment = hasLogExpression(node))) {
    const { value } = comment;

    if (comment.type === 'log') {
      const expression = getExpression(value);
      node.trailingComments = [];
      return {
        type: 'result',
        expression,
      }
    } else if (comment.type === 'perf') {
      const perfMark = value.replace(/\s/g, '').slice(1);
      node.trailingComments = [];

      //attach performance on previous and next node
      if (perfMark.length === 0) {
        const markA = uuid();
        const markB = uuid();

        return {
          type: 'perf',
          expressions: [
            getPerfExpression(stateOpts, node.loc, [markA]),
            getPerfExpression(stateOpts, node.loc, [markB]),
            getPerfExpression(stateOpts, node.loc, [`${markA}-${markB}`, markA, markB]),
          ],
        }
      } else if (perfMark.length > 0) {
        // add mark
        if (perfMark.indexOf('=') === 0) {
          if (perfMark.length > 1) {
            return {
              type: 'perf',
              expressions: [
                getPerfExpression(stateOpts, node.loc, [perfMark.slice(1)]),
              ],
            }
          }

          return false;
        } else {
          // try to evaluate based on a previous mark
          // or support from start performance time
          const markB = uuid();

          if (perfMark.length > 0) {
            return {
              type: 'perf',
              expressions: [
                getPerfExpression(stateOpts, node.loc, [markB]),
                getPerfExpression(stateOpts, node.loc, [`${perfMark}-${markB}`, perfMark, markB]),
              ],
            }
          }
        }
      }
    }
  }

  return false;
};

const logThroughComments = (node, path, state) => {
  const log = checkComments(node, state.opts);

  if (log && log.type === 'result') {
    const { replace, expression } = getCallExpression(
      node,
      state.opts,
      path,
      log.expression
    );

    if (replace) {
      path.replaceWith(expression);
    } else {
      path.insertAfter(expression);
    }

    return true;
  } else if (log && log.type === 'perf') {
    switch (log.expressions.length) {
      case 3: {
        //measure inline the performance of expression
        const [markBefore, markAfter, measureExpression] = log.expressions;

        path.insertBefore(markBefore);
        path.insertAfter([markAfter, measureExpression]);
        break;
      }
      case 1: {
        //add a mark to use later
        const [markAfter] = log.expressions;
        path.insertAfter([markAfter]);
        break;
      }
      case 2: {
        //measure based on a previous mark
        const [markAfter, measureExpression] = log.expressions;
        path.insertAfter([markAfter, measureExpression]);
        break;
      }
      default:
        break;
    }
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

const isOnValArgs = (stateOpts, path, argNames, loc) => {
  const { line, rel, data } = stateOpts.toVal;

  if (line === loc.end.line && rel === stateOpts.doc.rel) {
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

    return !!found.length;
  }

  return false;
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
  callExpr,
  paren
) => {
  let properties = [getPropName(expression.property)];
  const extra = paren ? '()' : '';
  properties[0] = callExpr ? `${properties[0]}${extra}` : properties[0];
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

const getNameFromCallExpression = (expression, paren) => {
  let name;

  if (expression.callee.type === 'Identifier') {
    // with no arguments;
    name = paren ? `${expression.callee.name}()` : expression.callee.name;
  } else if (expression.callee.type === 'CallExpression') {
    name = getNameFromCallExpression(expression.callee);
    name = paren ? `${name}()` : name;
  } else if (expression.callee.type === 'MemberExpression') {
    return getNameFromMemberExpression(expression.callee, true, true, paren);
  } else if (expression.callee.type === 'FunctionExpression') {
    //TODO:
  }

  return name;
};

const getNameFromExpression = (
  expression,
  returnDotted = false,
  paren = true
) => {
  const { type } = expression;

  switch (type) {
    case 'CallExpression':
      return getNameFromCallExpression(expression, paren);
    case 'MemberExpression':
      return getNameFromMemberExpression(
        expression,
        returnDotted,
        false,
        paren
      );
    case 'AssignmentExpression':
      // TODO: node.left.properties
      return expression.left.name;
    default:
      return expression.name || expression.value;
  }
};

const isOnLogArgs = (stateOpts, args, callee) => {
  const { toVal } = stateOpts;
  const name = toVal.data[0].name;
  const names = getNamesFromArgs(args);
  const index = names.findIndex(key => name === key);

  if (index > -1) {
    // log expression
    args[0] = t.arrayExpression([args[0].elements[index]]);
    callee.property.name = 'val';

    // loc array expression
    if (names.length > 1) {
      const loc = args[1];
      if (loc.elements && loc.elements.length > 1) {
        args[1] = args[1].elements[index];
      }
    }

    if (names.length > 1 && index > 0) {
      // reorder element names in arrayExpression
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

    // idx
    args[4] = t.numericLiteral(stateOpts.doc.idx);

    return true;
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

  return { same, exprNode, source };
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
          const { same, exprNode, source } = checkSourceExpr(
            node,
            path,
            expression
          );
          // instead to use map again
          if (same) {
            data[key].exprNode = exprNode;
            // override with source if available, so semicolon stripped
            if (source) {
              data[key].expression = source;
            }
          }

          return line === loc.start.line && rel === stateOpts.doc.rel && same;
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
        // TODO: addExpressionStatement instead of exprs below
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
          // TODO: No loc(ation) for log through comments
          if (!state.opts.toVal) {
            return;
          }

          const node = path.node;
          const { callee, arguments: args, loc } = node;

          if (!loc) {
            return;
          }

          const { consoleName } = state.opts;
          if (args.length) {
            const hasLog = isLog(callee, consoleName);
            const hasVal = isVal(callee, consoleName);

            if (hasLog) {
              const { toVal } = state.opts;
              if (toVal.data.length === 1) {
                isOnLogArgs(state.opts, args, callee);
              } else if (toVal.data.length > 1) {
                const names = getNamesFromArgs(args);
                isOnValArgs(state.opts, path, names, loc);
              }
            } else if (hasVal) {
              const names = getNamesFromArgs(args);
              isOnValArgs(state.opts, path, names, loc);
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
            const { rel, idx } = state.opts.doc;
            const names = node.arguments.map(node => {
              let name = '';
              if (path.isIdentifier(node) || path.isExpression(node)) {
                name = getSource(path, node);
              }
              return t.stringLiteral(name);
            });

            let extraLocs = [];
            let locExpr;

            // only arg call expressions
            const callNames = names.map(name => stripParen(name.value));

            if (callNames.length) {
              callNames.forEach(name => {
                extraLocs.push(
                  prepareLoc(node.loc, name && getReferences(path, name))
                );
              });
            }

            if (extraLocs.length) {
              if (extraLocs.length > 1) {
                locExpr = t.arrayExpression(extraLocs);
              } else {
                locExpr = extraLocs[0];
              }
            } else {
              locExpr = prepareLoc(node.loc, extraLocs);
            }

            node.arguments = [
              t.arrayExpression(node.arguments),
              locExpr,
              t.stringLiteral(rel),
              t.arrayExpression(names),
              t.numericLiteral(idx)
            ];

            node.callee.object.name = state.opts.consoleName;
          }

          logThroughComments(node, path, state);
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
        },

        WhileStatement: function (path, state) {
          if (state.opts.detectInfiniteLoops > 0) {
            const detector = getDetectLoopStatement(state.opts, path.node.loc);
            path.node.body.body.unshift(detector);
          }
        },

        ForStatement: function (path, state) {
          if (state.opts.detectInfiniteLoops > 0) {
            const detector = getDetectLoopStatement(state.opts, path.node.loc);
            path.node.body.body.unshift(detector);
          }
        },

        DoWhileStatement: function (path, state) {
          if (state.opts.detectInfiniteLoops > 0) {
            const detector = getDetectLoopStatement(state.opts, path.node.loc);
            path.node.body.body.unshift(detector);
          }
        },
      }
    };
  }
};
