const { spawn } = require("node:child_process");
const path = require("node:path");
const electronExecutable = require("electron");
const viteExecutable = path.join(__dirname, "..", "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");

const rendererUrl = "http://127.0.0.1:5173";
let stopping = false;

const vite = spawn(viteExecutable, ["--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
    stdio: "inherit",
    shell: process.platform === "win32",
});

function stop(child) {
    if (child && !child.killed) {
        child.kill();
    }
}

async function waitForRenderer() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (vite.exitCode !== null) {
            throw new Error("Vite exited before the renderer became ready.");
        }

        try {
            const response = await fetch(rendererUrl);
            if (response.ok) {
                return;
            }
        } catch {
            // Renderer is still starting.
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error("Timed out waiting for the Vite renderer.");
}

void waitForRenderer()
    .then(() => {
        const electron = spawn(electronExecutable, ["."], {
            stdio: "inherit",
            env: {
                ...process.env,
                KOMOCONTROL_RENDERER_URL: rendererUrl,
            },
        });

        electron.on("exit", (code) => {
            stopping = true;
            stop(vite);
            process.exitCode = code ?? 0;
        });

        process.on("SIGINT", () => {
            if (!stopping) {
                stopping = true;
                stop(electron);
                stop(vite);
            }
        });
    })
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        stop(vite);
        process.exitCode = 1;
    });
