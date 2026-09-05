// Turbopack loaders must return JavaScript. Keep shader text unchanged.
module.exports = function (source) {
  return `export default ${JSON.stringify(source)};`
}
