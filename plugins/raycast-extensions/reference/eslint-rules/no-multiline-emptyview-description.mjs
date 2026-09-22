/**
 * ESLint rule: no newlines in a `List.EmptyView` / `Grid.EmptyView` description.
 *
 * WHY THIS IS A LINT RULE AND NOT A COMPONENT
 * ------------------------------------------
 * `List.EmptyView`'s `description` **collapses newlines** — a multi-line string
 * renders as one run-on line, so a numbered list becomes unreadable mush. That
 * makes it a mechanical defect, not a style preference.
 *
 * A shared `<EmptyView>` wrapper was considered and rejected: it cannot stop
 * anyone from using `List.EmptyView` directly, `description: string` cannot
 * express "contains no newline" in TypeScript, and normalizing at runtime would
 * *hide* the defect instead of preventing it. Lint is the mechanism that
 * actually catches it before merge.
 *
 * Documented at raycast-airbuddy/src/components/error-views.tsx:43-44:
 *   "List.EmptyView's `description` collapses newlines — a multi-line numbered
 *    list renders as a literal '...'. Keep every description to ONE short line
 *    and put the steps in the actions."
 *
 * Fix: keep the description to one short sentence; move multi-step guidance into
 * the `actions` prop, per the House Style empty/error-state rule.
 *
 * @type {import("eslint").Rule.RuleModule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow newlines in an EmptyView description, which Raycast collapses into one run-on line",
      recommended: true,
    },
    schema: [
      {
        type: "object",
        properties: {
          /** Extra component names to check (e.g. a local `<ErrorEmptyView>` wrapper). */
          additionalComponents: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      multiline:
        "EmptyView `description` must be a single line — Raycast collapses newlines, so this renders as one run-on line. Move the steps into `actions`.",
    },
  },

  create(context) {
    const extra = context.options[0]?.additionalComponents ?? [];
    const targets = new Set(["EmptyView", ...extra]);

    /** Match `EmptyView`, `List.EmptyView`, `Grid.EmptyView`, and configured wrappers. */
    function isTargetElement(node) {
      const name = node.name;
      if (name.type === "JSXIdentifier") {
        return targets.has(name.name);
      }
      if (name.type === "JSXMemberExpression" && name.property.type === "JSXIdentifier") {
        return targets.has(name.property.name);
      }
      return false;
    }

    /** True when a string value carries a real or escaped newline. */
    function hasNewline(value) {
      return typeof value === "string" && /\n|\\n/.test(value);
    }

    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "description") {
          return;
        }
        const opening = node.parent;
        if (opening?.type !== "JSXOpeningElement" || !isTargetElement(opening)) {
          return;
        }

        const value = node.value;
        if (!value) {
          return;
        }

        // description="…\n…"
        if (value.type === "Literal" && hasNewline(value.value)) {
          context.report({ node: value, messageId: "multiline" });
          return;
        }

        if (value.type !== "JSXExpressionContainer") {
          return;
        }
        const expression = value.expression;

        // description={"…\n…"}
        if (expression.type === "Literal" && hasNewline(expression.value)) {
          context.report({ node: expression, messageId: "multiline" });
          return;
        }

        // description={`…
        // …`}  — only when there is no interpolation to reason about. A template
        // with expressions could still produce a newline at runtime, but flagging
        // that would be a guess; the literal quasis are the checkable part.
        if (expression.type === "TemplateLiteral") {
          const offending = expression.quasis.some(
            (quasi) => hasNewline(quasi.value.cooked) || hasNewline(quasi.value.raw),
          );
          if (offending) {
            context.report({ node: expression, messageId: "multiline" });
          }
        }
      },
    };
  },
};
