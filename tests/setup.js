process.env.LOG_LEVEL = "error";

// Suppress the express-rate-limit trust-proxy validation warning.
// The app must use trust proxy: true for Render.com; this warning is expected in tests.
const _consoleError = console.error.bind(console);
console.error = (...args) => {
  if (args[0] && args[0].code === "ERR_ERL_PERMISSIVE_TRUST_PROXY") return;
  _consoleError(...args);
};
