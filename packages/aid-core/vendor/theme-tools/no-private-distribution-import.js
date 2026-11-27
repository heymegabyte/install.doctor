import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils";
const createRule = ESLintUtils.RuleCreator(() => "https://github.com/heymegabyte/theme.tools/tree/main/packages/testing#typed-eslint");
const privatePackagePath = /^(@theme(?:\.tools|-tools)\/[^/]+)\/(?:src|dist)(?:\/|$)/u;
const publicPackagePath = /^@theme(?:\.tools|-tools)\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u;
export const noPrivateDistributionImport = createRule({
    name: "no-private-distribution-import",
    meta: {
        type: "problem",
        docs: {
            description: "Require public export paths for theme.tools imports and re-exports.",
        },
        fixable: "code",
        schema: [{ type: "object", additionalProperties: { type: "string" } }],
        defaultOptions: [{}],
        messages: {
            publicExport: "Specifier '{{specifier}}' bypasses the package exports. Use a documented public subpath.",
        },
    },
    create(context, [aliases]) {
        function checkSource(source) {
            if (source?.type !== AST_NODE_TYPES.Literal || typeof source.value !== "string")
                return;
            const packageName = privatePackagePath.exec(source.value)?.[1];
            if (!packageName && !/^(?:\.\.\/){2,}packages\/[^/]+\/(?:src|dist)(?:\/|$)/u.test(source.value))
                return;
            const replacement = Object.hasOwn(aliases, source.value) ? aliases[source.value] : undefined;
            const publicAlias = replacement && packageName
                && (replacement === packageName || replacement.startsWith(`${packageName}/`))
                && publicPackagePath.test(replacement) && !privatePackagePath.test(replacement)
                ? replacement
                : undefined;
            context.report({
                node: source,
                messageId: "publicExport",
                data: { specifier: source.value },
                fix: publicAlias ? (fixer) => {
                    const quote = source.raw.startsWith("'") ? "'" : '"';
                    return fixer.replaceText(source, `${quote}${publicAlias}${quote}`);
                } : null,
            });
        }
        return {
            ImportExpression: (node) => { checkSource(node.source); },
            ImportDeclaration: (node) => { checkSource(node.source); },
            ExportNamedDeclaration: (node) => { checkSource(node.source); },
            ExportAllDeclaration: (node) => { checkSource(node.source); },
        };
    },
});
//# sourceMappingURL=no-private-distribution-import.js.map