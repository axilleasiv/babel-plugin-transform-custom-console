'use strict';

const t = require('@babel/types');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse');
const allowedIdentifiers = ['expression', 'object'];

const getConsoleStatement = (node, stateOpts, line, nodeName, type) => {
  type = type || 'log';
  nodeName = nodeName || node.name;

  if (stateOpts.toVal && stateOpts.toVal === 'all') {
    type = 'val';
  }

  return t.expressionStatement(
    t.callExpression(
      t.memberExpression(
        t.identifier(stateOpts.consoleName),
        t.identifier(type)
      ),
      [
        node,
        t.numericLiteral(line || node.loc.end.line),
        t.stringLiteral(stateOpts.rel),
        nodeName && t.stringLiteral(nodeName)
      ]
    )
  );
};

const getCallExpression = (origNode, stateOpts, path, log) => {
  const identifier = path.scope.generateUidIdentifier('val');
  const line = origNode.loc.end.line;
  const type = origNode.type;
  const nodeName = origNode.declarations[0].id.name;
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
          line,
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
  properties = properties.join('.');
  return properties.replace(/\.[[]/g, '[');
  // return properties.join('.');
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

const isConsoleLog = callee => {
  if (
    callee.object &&
    callee.object.name === 'console' &&
    callee.property &&
    callee.property.name === 'log'
  ) {
    return true;
  }

  return false;
};

const checkEvaluation = (stateOpts, path, name, line) => {
  const expressions = [];

  stateOpts.toVal
    .filter(function(val) {
      return (
        val.name.indexOf(name) === 0 &&
        // when log through comments, we can't rely on the line,
        // cause the line has been changed for sure
        // the same can be true for ts and coffee files
        val.line === line &&
        val.rel === stateOpts.rel
      );
    })
    .forEach(function(item) {
      const name = item.name;
      expressions.push(
        getConsoleStatement(
          createMemberExpression(name),
          stateOpts,
          line,
          'evaluation:' + name,
          'val'
        )
      );
    });

  if (expressions.length) {
    path.replaceWithMultiple(expressions);
  }

  stateOpts.toVal = stateOpts.toVal.filter(function(val) {
    return !(
      val.name.indexOf(name) === 0 &&
      val.line === line &&
      val.rel === stateOpts.rel
    );
  });

  if (stateOpts.toVal.length === 0) {
    stateOpts.toVal = null;
  }
};

const isEvalAll = () => {};

module.exports = function() {
  return {
    name: 'console',
    visitor: {
      Program: {
        exit(path, state) {
          if (state.opts.toVal) {
            state.opts.toVal = null;
          }
        }
      },
      VariableDeclaration(path, state) {
        const node = path.node;

        if (node.declarations.length === 1) {
          logThroughComments(node, path, state);
        }
      },

      CallExpression(path, state) {
        const node = path.node;

        if (node.arguments.length && isConsoleLog(node.callee)) {
          const line = node.loc.end.line;
          const rel = state.opts.rel;
          let name;
          if (node.arguments[0].type === 'MemberExpression') {
            name = getNameFromExpression(node.arguments[0]);
          } else {
            name = node.arguments[0].name || '';
          }

          if (state.opts.toVal && state.opts.toVal !== 'all') {
            checkEvaluation(state.opts, path, name, line);
            return;
          } else {
            node.arguments.push(
              t.numericLiteral(line),
              t.stringLiteral(rel),
              t.stringLiteral(name)
            );

            node.callee.object.name = state.opts.consoleName;
            if (state.opts.toVal === 'all') {
              node.callee.property.name = 'val';
            }
          }

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
          const line = node.loc.end.line;
          const name = node.name;
          if (state.opts.toVal && state.opts.toVal !== 'all') {
            checkEvaluation(state.opts, path, name, line);
          } else {
            path.replaceWith(getConsoleStatement(node, state.opts, line, name));
          }

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
};
