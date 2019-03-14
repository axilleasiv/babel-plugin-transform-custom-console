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
  filename,
  comments: false
};

const $console = {
  log: jest.fn(function() {
    var args = Array.prototype.slice.call(arguments);

    return args;
  })
};

beforeEach(() => {
  $console.log.mockClear();
});

it('simple one line console', () => {
  const { code } = babel.transform(`console.log(1)`, config);
  expect(code).toMatchSnapshot();
});

it('simple console message', () => {
  const { code } = babel.transform(`console.log('message')`, config);
  expect(code).toMatchSnapshot();
});

it('console message with arguments', () => {
  const { code } = babel.transform(
    `console.log('Array', [1, 2, 3], 'Object', '{a:1, b:2}')`,
    config
  );
  expect(code).toMatchSnapshot();
});

it('CommentLine log on var', () => {
  const { code } = babel.transform(
    `var arr = [1000, 200, 5, 5555] //=`,
    config
  );
  expect(code).toMatchSnapshot();
});

it('CommentBlock log on var', () => {
  const { code } = babel.transform(
    `var arr = [1000, 200, 5, 5555] /*=*/`,
    config
  );
  expect(code).toMatchSnapshot();

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(1);
  expect($console.log).toBeCalledWith([1000, 200, 5, 5555], 1);
});

it('CommentLine log expression', () => {
  const { code } = babel.transform(
    `var arr = [1000, 200, 5, 5555] //= $.length`,
    config
  );
  expect(code).toMatchSnapshot();

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(1);
  expect($console.log).toBeCalledWith(4, 1);
});

it('BinaryExpression', () => {
  const { code } = babel.transform(`1000 + 1000`, config);

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(1);
  expect($console.log).toBeCalledWith(2000, 1);
});

it('Identifier expression', () => {
  const { code } = babel.transform(`var arr = [1000, 200];\n arr`, config);

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(1);
  expect($console.log).toBeCalledWith([1000, 200], 2);
});

it('Identifier through comments', () => {
  const { code } = babel.transform(`var arr = [1000, 200];\n arr //=`, config);

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(1);
  expect($console.log).toBeCalledWith([1000, 200], 2);
});

it('Identifier through comments property', () => {
  const { code } = babel.transform(
    `var arr = [1000, 200];\n arr //= $.length`,
    config
  );

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(1);
  expect($console.log).toBeCalledWith(2, 2);
});

it('VariableDeclaration through comments', () => {
  const { code } = babel.transform(
    `var arr = [1000, 200]; //=
    var arr2 = [1000, 200]; //= $.length`,
    config
  );

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(2);
  expect($console.log).toBeCalledWith([1000, 200], 1);
  expect($console.log).toBeCalledWith(2, 2);
});

it('MemberExpression through comments', () => {
  const { code } = babel.transform(
    `var arr = [1000, 200];
    arr.length; //=`,
    config
  );

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(1);
  expect($console.log).toBeCalledWith(2, 2);
});

it('CallExpression', () => {
  const { code } = babel.transform(
    `
    var i = 0;
    function fn() {
      i++;
      return 'value';
    }
    fn(); //=
    console.log(i);
    `,
    config
  );

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(2);
  expect($console.log).toBeCalledWith('value', 7);
  expect($console.log).toBeCalledWith(1, 8);
});

it('CallExpression object', () => {
  const { code } = babel.transform(
    `
    var i = 0;
    var obj = {
      fn: function() {
        i++;
        return 'value';
      }
    }
    obj.fn(); //=
    console.log(i);
    `,
    config
  );

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(2);
  expect($console.log).toBeCalledWith('value', 9);
  expect($console.log).toBeCalledWith(1, 10);
});

it('Check double comments or falsy chars', () => {
  const { code } = babel.transform(
    `
      var obj = {
        a: 5,
        b: 6,
        c: 7
      }

      obj; //= //=$.c
      obj.a; //= //=
      obj.b; /*=*/ /*=*/
      obj.c; //= (((((#$@(&*^@!)@!)@!#^$@!)))))
    `,
    config
  );

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(4);
  expect($console.log).toBeCalledWith(7, 8);
  expect($console.log).toBeCalledWith(5, 9);
  expect($console.log).toBeCalledWith(6, 10);
});

// TODO:
it('Expression through comments', () => {
  const { code } = babel.transform(
    `
      var i = 0;
      var arr = [1, 2, 3] //= i++;
      i //=
      i /*=*/
      i /*= i++ */
      i
      arr//= arr.length
      arr//= $.length
    `,
    config
  );

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(7);
  expect($console.log).toBeCalledWith(2, 7);
});

it('Chain CallExpression', () => {
  const { code } = babel.transform(
    `
      var arr = [1000, 200, 10, 1];

      arr //=
        .sort(function(a, b) {
          return a > b
        }) //=
        .filter(function(val) {
          return val > 5
        }) //=
        .reverse() //=
    `,
    config
  );

  eval(code);

  expect(code).toMatchSnapshot();
  expect($console.log).toHaveBeenCalledTimes(4);
  expect($console.log).toHaveBeenCalledWith([1, 10, 200, 1000], 4);
  expect($console.log.mock.calls[1][1]).toBe(7);
  expect($console.log.mock.calls[2][1]).toBe(10);
  expect($console.log).lastCalledWith([1000, 200, 10], 11);
});

it('Chain CallExpression 2', () => {
  const { code } = babel.transform(
    `
      var locations = [
        {
          id: 1,
          name: 'Paris',
          country: 'France',
          population: 2140526
        },
        {
          id: 7,
          name: 'Athens',
          country: 'Greece',
          population: 3090508
        },
        {
          id: 9,
          name: 'Los Angeles',
          country: 'United States',
          population: 3999759
        }
      ]; //=

      var getCountry = country => 'The country is: ' + country; //=

      var result = locations //= $.length
        .filter(location => {
          return location.population /*=*/ >= 2200000 &&
           location.population <= 4000000 //=
        })
        .map(location => {
          return getCountry(location.country /*=*/); //=
        })/*= $.length */

        console.log(result);
    `,
    config
  );

  eval(code);

  expect(code).toMatchSnapshot();
  expect($console.log).toHaveBeenCalledTimes(15);
  expect($console.log).toHaveBeenCalledWith(3, 25);
  expect($console.log).toHaveBeenCalledWith(3999759, 27);
  expect($console.log).toHaveBeenCalledWith(3090508, 27);
  expect($console.log).toHaveBeenCalledWith(2140526, 27);
  expect($console.log).toHaveBeenCalledWith(false, 28);
  expect($console.log).toHaveBeenCalledWith(true, 28);
  expect($console.log).toHaveBeenCalledWith(true, 28);
  expect($console.log).toHaveBeenCalledWith('Greece', 31);
  expect($console.log).toHaveBeenCalledWith('United States', 31);
  expect($console.log).toHaveBeenCalledWith('The country is: Greece', 31);
  expect($console.log).toHaveBeenCalledWith(
    'The country is: United States',
    31
  );
  expect($console.log).toHaveBeenCalledWith(2, 32);
  expect($console.log).toHaveBeenCalledWith(
    ['The country is: Greece', 'The country is: United States'],
    34
  );
});
