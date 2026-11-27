import { AST_NODE_TYPES, ESLintUtils } from "@typescript-eslint/utils";
const createRule = ESLintUtils.RuleCreator(() => "https://github.com/heymegabyte/theme.tools/tree/main/packages/testing#typed-eslint");
export const noDynamicShellCommandRule = createRule({
    name: "no-dynamic-shell-command",
    meta: {
        type: "problem",
        docs: { description: "Require literal command strings for Node exec and execSync." },
        schema: [],
        defaultOptions: [],
        messages: {
            dynamicCommand: "Pass a fixed executable and a separate argument array to execFile or spawn with the shell disabled.",
        },
    },
    create(context) {
        const services = ESLintUtils.getParserServices(context);
        const checker = services.program.getTypeChecker();
        return {
            CallExpression(node) {
                const command = node.arguments.at(0);
                if (!command
                    || (command.type === AST_NODE_TYPES.Literal && typeof command.value === "string")
                    || (command.type === AST_NODE_TYPES.TemplateLiteral && command.expressions.length === 0))
                    return;
                const signature = checker.getResolvedSignature(services.esTreeNodeToTSNodeMap.get(node));
                const declaration = signature?.getDeclaration();
                if (!declaration)
                    return;
                const name = declaration.name?.getText();
                if (name !== "exec" && name !== "execSync")
                    return;
                const filename = declaration.getSourceFile().fileName.replace(/\\/gu, "/");
                if (filename.endsWith("/@types/node/child_process.d.ts")) {
                    context.report({ node: command, messageId: "dynamicCommand" });
                }
            },
        };
    },
});
//# sourceMappingURL=no-dynamic-shell-command.js.map