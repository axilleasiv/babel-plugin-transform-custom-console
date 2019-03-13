const babel = require('babel-core');
const plugin = require('../lib/index');

const plugins = [
  [
    plugin,
    {
      consoleName: '$console',
      fileName: 'file'
    }
  ]
];
const filename = 'file';
const config = {
  plugins,
  filename
};

const $console = {
  log: jest.fn()
};

beforeEach(() => {
  $console.log.mockClear();
});

const simpleOneLine = `console.log(1)`;

it('simple one line console', () => {
  const { code } = babel.transform(simpleOneLine, config);
  expect(code).toMatchSnapshot();
});

const simpleConsoleMessage = `console.log('message')`;

it('simple console message', () => {
  const { code } = babel.transform(simpleConsoleMessage, config);
  expect(code).toMatchSnapshot();
});

const simpleArgsMessage = `console.log('Array', [1, 2, 3], 'Object', '{a:1, b:2}' )`;

it('console message with arguments', () => {
  const { code } = babel.transform(simpleArgsMessage, config);
  expect(code).toMatchSnapshot();
});

const arrStr = `var arr = [1000, 200, 5, 5555]`;
const commentLine = `${arrStr} //=`;

it('CommentLine log on var', () => {
  const { code } = babel.transform(commentLine, config);
  expect(code).toMatchSnapshot();
});

const commentBlock = `${arrStr} /*=*/`;

it('CommentBlock log on var', () => {
  const { code } = babel.transform(commentBlock, config);
  expect(code).toMatchSnapshot();
});

const commentLineExpr = `${arrStr} //= $.length`;

it('CommentLine log expression', () => {
  const { code } = babel.transform(commentLineExpr, config);
  expect(code).toMatchSnapshot();

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(1);
  expect($console.log).toBeCalledWith(4, 1);
});

const commentBlockExpr = `
  ${arrStr} /*= $.length */
`;

it('CommentBlock log expression', () => {
  const { code } = babel.transform(commentBlockExpr, config);
  expect(code).toMatchSnapshot();

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(1);
  expect($console.log).toBeCalledWith(4, 2);
});
