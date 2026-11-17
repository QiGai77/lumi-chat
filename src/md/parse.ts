/*
 * Markdown + LaTeX parsing. Ported from deepseek-ai/chat-demo (MIT) services/markdown/parse.ts:
 * micromark GFM (indented code disabled, so indented lists from LLMs render) + llm-math, which accepts
 * $..$, $$..$$, \(..\) and \[..\] the way models actually write formulas.
 */
import type { Nodes, Parent, Root, RootContent, Text } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-llm-math'

const text = (value: string): Text => ({ type: 'text', value })

export function toMdAst(input: string): Root {
  const ast = fromMarkdown(input, {
    extensions: [{ ...gfm(), disable: { null: ['codeIndented'] } }, math({ singleDollarTextMath: true })],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
  const raw = (n: Nodes) => input.slice(n.position?.start.offset, n.position?.end.offset)
  const simplify = (node: Nodes): Nodes[] => {
    if ('children' in node) (node as Parent).children = node.children.flatMap(simplify) as RootContent[]
    switch (node.type) {
      case 'footnoteReference': case 'imageReference': case 'linkReference':
        return [text(raw(node))]
      case 'inlineMath': {
        // $$..$$ or \[..\] written on one line parses as inline math; keep it display-style
        const r = raw(node)
        if (r.startsWith('$$') || r.startsWith('\\[')) (node as { display?: boolean }).display = true
        return [node]
      }
      case 'footnoteDefinition': case 'definition':
        return [{ type: 'paragraph', children: [text(raw(node))] }]
      default:
        return [node]
    }
  }
  simplify(ast)
  return ast
}
