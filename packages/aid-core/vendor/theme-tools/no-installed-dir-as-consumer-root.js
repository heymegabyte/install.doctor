import { AST_NODE_TYPES, ASTUtils, ESLintUtils } from "@typescript-eslint/utils";
import { isInstalledPath, normalizePortablePath } from "./consumer-project-path.js";
const createRule = ESLintUtils.RuleCreator(() => "https://github.com/heymegabyte/theme.tools/tree/main/packages/testing#typed-eslint");
export const noInstalledDirAsConsumerRoot = createRule({
    name: "no-installed-dir-as-consumer-root",
    meta: {
        type: "problem",
        docs: { description: "Use the consumer project root when configuring shared typed lint." },
        schema: [],
        defaultOptions: [],
        messages: {
            consumerRoot: "Use the consumer project root for tsconfigRootDir. This path points into installed dependencies.",
        },
    },
    create(context) {
        function refersToSharedFactory(callee) {
            const binding = ASTUtils.findVariable(context.sourceCode.getScope(callee), callee);
            return binding?.defs.some(({ node }) => {
                if (node.type !== AST_NODE_TYPES.ImportSpecifier)
                    return false;
                const imported = node.imported;
                return imported.type === AST_NODE_TYPES.Identifier
                    && imported.name === "createThemeToolsTypedLintConfig"
                    && node.parent.type === AST_NODE_TYPES.ImportDeclaration
                    && node.parent.source.value === "@theme-tools/testing/typed-eslint-config";
            }) ?? false;
        }
        return {
            CallExpression(node) {
                const options = node.arguments.at(0);
                if (node.callee.type !== AST_NODE_TYPES.Identifier
                    || options?.type !== AST_NODE_TYPES.ObjectExpression
                    || !refersToSharedFactory(node.callee))
                    return;
                for (const property of options.properties) {
                    if (property.type !== AST_NODE_TYPES.Property || property.computed
                        || property.value.type !== AST_NODE_TYPES.Literal || typeof property.value.value !== "string")
                        continue;
                    const { key, value } = property;
                    const propertyName = key.type === AST_NODE_TYPES.Identifier ? key.name : key.value;
                    if (propertyName !== "tsconfigRootDir")
                        continue;
                    if (isInstalledPath(normalizePortablePath(value.value))) {
                        context.report({ node: value, messageId: "consumerRoot" });
                    }
                }
            },
        };
    },
});
//# sourceMappingURL=no-installed-dir-as-consumer-root.js.map