# babel-plugin-transform-custom-console

> Replace console.log statements with a custom name, is not supposed to be used for general purposes

## Usage

### Via `.babelrc` (Recommended)

**.babelrc**

```json
{
  "plugins": ["babel-plugin-transform-custom-console"]
}
```

### Via CLI

```sh
babel --plugins babel-plugin-transform-custom-console script.js
```

### Via Node API

```javascript
require('babel-core').transform('code', {
  plugins: ['babel-plugin-transform-custom-console']
});
```
