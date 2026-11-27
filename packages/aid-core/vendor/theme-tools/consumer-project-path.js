export function normalizePortablePath(rawPath) {
    const segments = [];
    for (const segment of rawPath.trim().replace(/\\/g, "/").split("/")) {
        if (segment === "..")
            segments.pop();
        else if (segment && segment !== ".")
            segments.push(segment);
    }
    return `/${segments.join("/")}`;
}
export function isInstalledPath(normalizedPath) {
    return normalizedPath.split("/").includes("node_modules")
        || `${normalizedPath}/`.includes("/vendor/theme-tools/");
}
//# sourceMappingURL=consumer-project-path.js.map