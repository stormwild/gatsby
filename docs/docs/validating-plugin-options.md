---
title: Validating plugin options
---

In order to make [plugin configuration](/docs/configuring-usage-with-plugin-options/) easier for users, plugins can optionally define a [Joi](https://joi.dev) schema to enforce data types for each option using the [`pluginOptionsSchema` API](/docs/node-apis/#pluginOptionsSchema) in `gatsby-node.js`. When users of the plugin pass configuration options, Gatsby will validate that the options match the schema.

## How to define an options schema

Consider the following `gatsby-config` with a plugin called `gatsby-plugin-console-log`:

```javascript:title=gatsby-config.js
module.exports = {
  plugins: [
    {
      resolve: `gatsby-plugin-console-log`,
      options: { optionA: true, optionB: false, message: "Hello world" },
    },
  ],
}
```

`gatsby-plugin-console-log` can ensure users pass a boolean to `optionA` and `optionB`, and a string to `message` with this `pluginOptionsSchema`:

```javascript:title=plugins/gatsby-plugin-console-log/gatsby-node.js
exports.pluginOptionsSchema = ({ Joi }) => {
  return Joi.object({
    optionA: Joi.boolean().required(),
    message: Joi.string().required(),
    optionB: Joi.boolean(),
  })
}
```

If users pass options that do not match the schema, the validation will show an error when they run `gatsby develop`.

## Unit testing an options schema

In order to verify that a `pluginOptionsSchema` behaves as expected, we recommend that you unit test it with various configurations using the `gatsby-plugin-utils` package.

1. Add the `gatsby-plugin-utils` package to your site:

   ```shell
   yarn add gatsby-plugin-utils
   ```

   or

   ```shell
   npm install gatsby-plugin-utils
   ```

2. Use the `testPluginOptionsSchema` function exported from it in your test file. For example, with [Jest](https://jestjs.io):

   ```javascript:title=plugins/gatsby-plugin-console/__tests__/pluginOptionsSchema.test.js
   // This is an example using Jest (https://jestjs.io/)
   import { testPluginOptionsSchema } from "gatsby-plugin-utils"
   import { pluginOptionsSchema } from "../gatsby-node"

   it(`should invalidate incorrect options`, () => {
     const options = {
       optionA: undefined, // Should be a boolean
       message: 123, // Should be a string
       optionB: `not a boolean`, // Should be a boolean
     }
     const { isValid, errors } = testPluginOptionsSchema(pluginOptionsSchema, options)

     expect(isValid).toBe(false)
     expect(errors).toEqual([
       `"optionA" is required`,
       `"message" must be a string`,
       `"optionB" must be a boolean`,
     ])
   })

   it(`should validate correct options`, () => {
     const options = {
       optionA: ,
       message: "string",
       optionB: true,
     }
     const { isValid, errors } = testPluginOptionsSchema(pluginOptionsSchema, options)

     expect(isValid).toBe(true)
     expect(errors).toEqual([])
   })
   ```

## Joi tips

While working on a `pluginOptionsSchema`, it is helpful to refer to the [Joi API documentation](https://joi.dev/api/) for all the available types and methods. Apart from that, here are some tips and hidden features that we recommend you use for the best experience for your plugin users.

### Setting default options

You can use the `.default()` method to set a default for an option. For example with `gatsby-plugin-console-log`, this is how it can default the `message` option to "default message" in case users do not pass their own:

```javascript:title=plugins/gatsby-plugin-console-log/gatsby-node.js
exports.pluginOptionsSchema = ({ Joi }) => {
  return Joi.object({
    optionA: Joi.boolean().required(),
    message: Joi.string().default(`default message`),
    optionB: Joi.boolean(),
  })
}
```

Accessing `pluginOptions.message` would then log `"default message"` in all plugin APIs if users do not supply their own value:

```javascript:title=plugins/gatsby-plugin-console-log/gatsby-node.js
exports.onPreInit = (_, pluginOptions) => {
  console.log(
    `logging: "${pluginOptions.message}" to the console` // highlight-line
  )
}
```

### Validating external access

TK `.external()`

### Using custom error messages

TK `.messages()`

### Deprecating options

TK `.forbidden()`

## Additional resources

- [Joi API documentation](https://joi.dev/api/)
- [`pluginOptionsSchema` for the Contentful source plugin](https://github.com/gatsbyjs/gatsby/blob/af973d4647dc14c85555a2ad8f1aff08028ee3b7/packages/gatsby-source-contentful/src/gatsby-node.js#L75-L159)