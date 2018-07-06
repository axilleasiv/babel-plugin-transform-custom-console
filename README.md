# babel-plugin-transform-custom-repl

> Add console.log statements to some member expressions, used only in vscode-javascript-repl, and is not supposed to be used for general purposes

## Installation

```sh
npm install --save-dev babel-plugin-transform-custom-repl
```

## Usage

### Via `.babelrc` (Recommended)

**.babelrc**

```json
{
  "plugins": [babel-plugin-transform-custom-repl"]
}
```

### Via CLI

```sh
babel --plugins babel-plugin-transform-custom-repl script.js
```

### Via Node API

```javascript
require("babel-core").transform("code", {
  plugins: ["babel-plugin-transform-custom-repl"]
});
```
