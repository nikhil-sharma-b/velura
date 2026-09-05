/** Small, deterministic snippet expansion: no runtime mode branches (D20/D34). */
export function preprocess(
  source: string,
  includes: Readonly<Record<string, string>>
): string {
  const expand = (text: string, parents: string[]): string =>
    text.replace(/^\s*#include "([\w./-]+)"\s*$/gm, (_, name: string) => {
      if (!(name in includes)) throw new Error(`Missing WGSL include: ${name}`)
      if (parents.includes(name))
        throw new Error(`Cyclic WGSL include: ${name}`)
      return expand(includes[name], [...parents, name])
    })
  // Object-like defines only: snippets do not need a full C preprocessor.
  const defines = new Map<string, string>()
  const expanded = expand(source, []).replace(
    /^\s*#define (\w+) ([^\n]+)$/gm,
    (_, name: string, value: string) => {
      defines.set(name, value)
      return ""
    }
  )
  return expanded.replace(/\b\w+\b/g, (token) => defines.get(token) ?? token)
}
