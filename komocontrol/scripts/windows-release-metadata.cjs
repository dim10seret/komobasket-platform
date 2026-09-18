const fs = require("node:fs/promises");
const path = require("node:path");

// electron-builder uses productName for FileDescription. Keep the product
// identity and use the canonical package description for this unsigned RC.
module.exports = async function windowsReleaseMetadata(context) {
    if (context.electronPlatformName !== "win32") return;
    const { NtExecutable, NtExecutableResource, Resource } = await import("resedit");
    const info = context.packager.appInfo;
    const executablePath = path.join(context.appOutDir, `${info.productFilename}.exe`);
    // Refuse signed input rather than silently invalidating a future signature.
    const executable = NtExecutable.from(await fs.readFile(executablePath));
    const resources = NtExecutableResource.from(executable);
    const versions = Resource.VersionInfo.fromEntries(resources.entries);
    if (versions.length === 0) throw new Error("Windows version metadata is missing.");
    for (const version of versions) {
        const languages = version.getAllLanguagesForStringValues();
        if (languages.length === 0) throw new Error("Windows metadata language is missing.");
        for (const language of languages) {
            version.setStringValues(language, {
                ProductName: info.productName,
                CompanyName: info.companyName,
                FileDescription: info.description,
                LegalCopyright: info.copyright,
            });
        }
        version.outputToResourceEntries(resources.entries);
    }
    resources.outputResource(executable);
    await fs.writeFile(executablePath, Buffer.from(executable.generate()));
};
