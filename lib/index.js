'use strict';

var t = require('@babel/types');
var parser = require('@babel/parser');
var traverse = require('@babel/traverse');
var allowedIdentifiers = ['expression', 'object'];

function getConsoleStatement(node, stateOpts, line, nodeName, type) {
  type = type || 'log';
  nodeName = nodeName || node.name;

  var statement = t.expressionStatement(
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

  return statement;
}

function getCallExpression(origNode, stateOpts, path, log) {
  var identifier = path.scope.generateUidIdentifier('val');
  var line = origNode.loc.end.line;
  var type = origNode.type;
  var expression, propertyExpression, node;
  var nodeName = origNode.declarations[0].id.name;

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
}

function isExpression(comment) {
  return comment.charAt(0) === '=';
}

function hasLogExpression(node) {
  return (
    node.trailingComments &&
    node.trailingComments.length &&
    isExpression(node.trailingComments[0].value)
  );
}

function getExpression(comment) {
  comment = comment.replace(/\s/g, '').slice(1);

  if (comment !== '' && comment.length > 2) {
    if (comment.indexOf('$.') !== -1) {
      var property = comment.split('$.')[1];

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
}

function getIdentifier(property) {
  // TODO:
  /* if (isSymbol(property)) {
    const symbolArr = property.split('_symbol_');
    return t.memberExpression(symbolArr[0], symbolArr[1]);
  } */

  return t.identifier(property);
}

function isSymbol(property) {
  // global.Array.prototype.Symbol_symbol_iterator;
  return property.includes('_symbol_');
}

function isComputed(property) {
  // TODO:
  // if (isSymbol(property)) {
  //   return true;
  // } else {
  const propInt = parseInt(property);
  return !Number.isNaN(propInt);
}

function createMemberExpression(dotted) {
  dotted = dotted.split('.');
  var memberExpression = t.memberExpression(
    getIdentifier(dotted[0]),
    getIdentifier(dotted[1]),
    isComputed(dotted[1])
  );
  var arr = dotted.slice(2);

  while (arr.length) {
    var property = arr.shift();
    memberExpression = t.memberExpression(
      memberExpression,
      getIdentifier(property),
      isComputed(property)
    );
  }

  return memberExpression;
}

function getPropName(prop) {
  return prop.name || '[' + prop.value + ']';
}

function getNameFromExpression(expression) {
  var properties = [getPropName(expression.property)];
  var object = expression.object;

  while (object.type === 'MemberExpression') {
    properties.unshift(getPropName(object.property));
    object = object.object;
  }

  properties.unshift(object.name);
  properties = properties.join('.');
  return properties.replace(/\.[[]/g, '[');

  // return properties.join('.');
}

function checkComments(node) {
  if (hasLogExpression(node)) {
    var comment = node.trailingComments[0].value;
    var expression = getExpression(comment);

    node.trailingComments = [];

    return expression;
  }

  return false;
}

function logThroughComments(node, path, state) {
  var log = checkComments(node);

  if (log) {
    path.replaceWith(getCallExpression(node, state.opts, path, log));

    return true;
  }

  return false;
}

function isConsoleLog(callee) {
  if (
    callee.object &&
    callee.object.name === 'console' &&
    callee.property &&
    callee.property.name === 'log'
  ) {
    return true;
  }

  return false;
}

function checkEvaluation(stateOpts, path, name, line) {
  const expressions = [];

  stateOpts.toVal
    .filter(function(val) {
      return (
        val.name.indexOf(name) === 0 &&
        //when log through comments, we can't rely on the line,
        //cause the line has been changed for sure
        // the same can be true for ts and coffee files
        val.line === line &&
        val.rel === stateOpts.rel
      );
    })
    .forEach(function(item) {
      var name = item.name;
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
}

module.exports = function() {
  return {
    name: 'console',
    visitor: {
      VariableDeclaration: function VariableDeclaration(path, state) {
        var node = path.node;

        if (node.declarations.length === 1) {
          logThroughComments(node, path, state);
        }
      },

      CallExpression: function CallExpression(path, state) {
        var node = path.node;

        if (node.arguments.length && isConsoleLog(node.callee)) {
          var line = node.loc.end.line;
          var rel = state.opts.rel;
          var name;
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
          }

          return;
        }

        logThroughComments(node, path, state);
        logThroughComments(path.parent, path, state);
      },

      ReturnStatement: function ReturnStatement(path, state) {
        var node = path.node;

        logThroughComments(node, path, state);
      },
      // TODO: what we need this? will we support arr.length
      // or other member expressions without comments
      MemberExpression: function MemberExpression(path, state) {
        var node = path.node;

        logThroughComments(node, path, state);
        if (logThroughComments(path.parent, path, state)) {
          path.skip();
        }
      },

      Identifier: function Identifier(path, state) {
        var node = path.node;

        // TODO: node.name = cov_jbjx08c0d;

        if (allowedIdentifiers.indexOf(path.parentKey) === -1) {
          return;
        }

        if (
          logThroughComments(node, path, state) ||
          logThroughComments(path.parent, path, state)
        ) {
          return;
        }

        if (path.parentKey === 'expression') {
          var line = node.loc.end.line;
          var name = node.name;
          if (state.opts.toVal && state.opts.toVal !== 'all') {
            checkEvaluation(state.opts, path, name, line);
          } else {
            path.replaceWith(getConsoleStatement(node, state.opts, line, name));
          }

          path.skip();
        }
      },

      BinaryExpression: function BinaryExpression(path, state) {
        var node = path.node;

        if (path.parentKey === 'expression') {
          path.replaceWith(getConsoleStatement(node, state.opts, undefined));
        }
      }
    }
  };
};
