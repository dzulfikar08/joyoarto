// A Joyo answer's markdown as native views, from the same parser as the web (packages/api/src/lib/joyo-ai/markdown,
// pure, shared on purpose). Text stays text: there is no HTML path, and links open only for http(s)/mailto.

import { parseMarkdown, type Align, type Block, type Inline, type ListItem } from "@baroka/api/lib/joyo-ai/markdown/parse";
import { Fragment, memo, useMemo, type ReactNode } from "react";
import { Linking, Platform, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "@/components/ui";
import { safeHref } from "@/src/lib/joyo";

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

function inline(nodes: readonly Inline[], key = ""): ReactNode[] {
  return nodes.map((node, i) => {
    const k = `${key}${i}`;
    switch (node.t) {
      case "text":
        return <Fragment key={k}>{node.s}</Fragment>;
      case "br":
        return <Fragment key={k}>{"\n"}</Fragment>;
      case "bold":
        return (
          <Text key={k} style={styles.bold}>
            {inline(node.c, `${k}.`)}
          </Text>
        );
      case "italic":
        return (
          <Text key={k} style={styles.italic}>
            {inline(node.c, `${k}.`)}
          </Text>
        );
      case "code":
        return (
          <Text key={k} style={styles.inlineCode}>
            {node.s}
          </Text>
        );
      case "link": {
        const href = safeHref(node.href);
        if (href === null) return <Fragment key={k}>{inline(node.c, `${k}.`)}</Fragment>;
        return (
          <Text key={k} style={styles.link} accessibilityRole="link" onPress={() => void Linking.openURL(href)}>
            {inline(node.c, `${k}.`)}
          </Text>
        );
      }
    }
  });
}

function Items({ items }: { items: readonly ListItem[] }) {
  return (
    <View style={{ gap: 4 }}>
      {items.map((item, i) => (
        <View key={i} style={[styles.item, { paddingLeft: item.depth * 18 }]}>
          <Text tone="muted" style={styles.marker}>
            {item.n === null ? (item.depth === 0 ? "•" : "◦") : `${item.n}.`}
          </Text>
          <Text style={styles.flex}>{inline(item.c)}</Text>
        </View>
      ))}
    </View>
  );
}

const alignOf = (a: Align | undefined) => (a === "right" ? "right" : a === "center" ? "center" : "left");

function Blocks({ blocks }: { blocks: readonly Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "p":
            return <Text key={i} style={styles.p}>{inline(b.c)}</Text>;
          case "h":
            return (
              <Text key={i} variant={b.level < 3 ? "heading" : "label"} accessibilityRole="header" style={i > 0 ? { paddingTop: 4 } : undefined}>
                {inline(b.c)}
              </Text>
            );
          case "ul":
          case "ol":
            return <Items key={i} items={b.items} />;
          case "code":
            return (
              <ScrollView key={i} horizontal style={styles.codeBlock} contentContainerStyle={{ padding: 12 }}>
                <Text style={styles.codeText}>{b.text}</Text>
              </ScrollView>
            );
          case "quote":
            return (
              <View key={i} style={styles.quote}>
                <Blocks blocks={b.c} />
              </View>
            );
          case "table":
            return (
              <ScrollView key={i} horizontal style={styles.table}>
                <View>
                  <View style={styles.tr}>
                    {b.head.map((cell, c) => (
                      <Text key={c} variant="label" style={[styles.td, { textAlign: alignOf(b.align[c]) }]}>
                        {inline(cell)}
                      </Text>
                    ))}
                  </View>
                  {b.rows.map((row, r) => (
                    <View key={r} style={[styles.tr, styles.trBorder]}>
                      {b.head.map((_, c) => (
                        <Text key={c} variant="label" style={[styles.td, styles.tdBody, { textAlign: alignOf(b.align[c]) }]}>
                          {inline(row[c] ?? [])}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );
          case "hr":
            return <View key={i} style={styles.hr} />;
        }
      })}
    </>
  );
}

/** `streaming` shows an unclosed `**` or code fence as what it is so far (the parser's streaming mode). */
export const JoyoMarkdown = memo(function JoyoMarkdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const blocks = useMemo(() => parseMarkdown(text, { streaming }), [text, streaming]);
  return (
    <View style={{ gap: 8 }}>
      <Blocks blocks={blocks} />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  p: { lineHeight: 22 },
  bold: { fontFamily: theme.fonts.bold },
  italic: { fontStyle: "italic" },
  inlineCode: { fontFamily: MONO, fontSize: theme.fontSize.sm, backgroundColor: theme.colors.muted },
  link: { color: theme.colors.primaryInk, textDecorationLine: "underline" },
  item: { flexDirection: "row", gap: 6 },
  marker: { minWidth: 16, textAlign: "right" },
  flex: { flex: 1, lineHeight: 22 },
  codeBlock: { backgroundColor: theme.colors.muted, borderRadius: theme.radius.tile },
  codeText: { fontFamily: MONO, fontSize: theme.fontSize.sm, lineHeight: 19 },
  quote: { paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: theme.colors.border, gap: 6, opacity: 0.85 },
  table: { backgroundColor: theme.colors.muted, borderRadius: theme.radius.tile },
  tr: { flexDirection: "row" },
  trBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  td: { width: 120, paddingHorizontal: 10, paddingVertical: 8, fontFamily: theme.fonts.bold },
  tdBody: { fontFamily: theme.fonts.regular },
  hr: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border },
}));
