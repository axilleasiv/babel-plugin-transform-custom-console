'use strict';

const t = require('@babel/types');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse');
const allowedIdentifiers = ['expression', 'object'];

const getConsoleStatement = (node, stateOpts, loc, nodeName, type) => {
  type = type || 'log';
  let nodeNameExpr;
  if (type === 'log') {
    nodeName = nodeName || node.name;
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
  const nodeName = declarations[0].id.name;
  let expression, propertyExpression, node;

  if (type === 'ExpressionStatement') {
    node = origNode.expression;
  } else if (type === 'ReturnStatement') {
    node = origNode.argument;
  } else if (type === 'VariableDeclaration') {
    node = origNode.declarations[0].init;
  } else {
    node = origNode;
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
  // TODO:
  /* if (isSymbol(property)) {
    const symbolArr = property.split('_symbol_');
    return t.memberExpression(symbolArr[0], symbolArr[1]);
  } */

  return t.identifier(property);
};

const isSymbol = property => {
  // global.Array.prototype.Symbol_symbol_iterator;
  return property.includes('_symbol_');
};

const isComputed = property => {
  // TODO:
  // if (isSymbol(property)) {
  //   return true;
  // } else {
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
  return prop.name || '[' + prop.value + ']';
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

const checkEvaluation = (stateOpts, path, name, loc) => {
  const members = [];
  const names = [];

  stateOpts.toVal
    .filter(function(val) {
      return (
        val.name.indexOf(name) === 0 &&
        // when log through comments, we can't rely on the line,
        // cause the line has been changed for sure
        // the same can be true for ts and coffee files
        val.line === loc.end.line &&
        val.rel === stateOpts.rel
      );
    })
    .forEach(function(item) {
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

  stateOpts.toVal = stateOpts.toVal.filter(function(val) {
    return !(
      val.name.indexOf(name) === 0 &&
      val.line === loc.end.line &&
      val.rel === stateOpts.rel
    );
  });

  if (stateOpts.toVal.length === 0) {
    stateOpts.toVal = null;
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

module.exports = {
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

              if (state.opts.toVal) {
                checkEvaluation(state.opts, path, name, loc);
              }
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
          if (allowedIdentifiers.indexOf(path.parentKey) === -1) {
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
            path.replaceWith(
              getConsoleStatement(path.node, state.opts, undefined)
            );
          }
        }
      }
    };
  }
};
