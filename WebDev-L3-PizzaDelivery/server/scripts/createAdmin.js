const readline = require("node:readline/promises");
const { Writable } = require("node:stream");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Admin = require("../models/Admin");

const messages = {
  INVALID_EMAIL: "Enter a valid administrator email address. No account was created.",
  PASSWORD_TOO_SHORT: "Password must contain at least 12 characters. No account was created.",
  PASSWORD_TOO_LONG: "Password must not exceed 72 UTF-8 bytes. No account was created.",
  PASSWORD_MISMATCH: "Passwords do not match. No account was created.",
  INTERACTIVE_REQUIRED: "An interactive terminal is required; do not supply credentials through arguments or piped input.",
  CANCELLED: "Administrator creation cancelled. No account was created.",
  ENV_READ_FAILED: "Cannot read server/.env. Check the file permissions.",
  MONGO_URI_MISSING: "MONGO_URI is missing. Configure it in the existing server/.env.",
  MONGO_URI_INVALID: "MONGO_URI has an invalid MongoDB format. Check the existing server/.env without sharing its contents.",
  ADMIN_EXISTS: "Administrator with this email already exists. No account was overwritten.",
  MONGO_AUTH_FAILED: "MongoDB authentication failed. Check the database user credentials in server/.env.",
  MONGO_PERMISSION_DENIED: "MongoDB denied this operation. Check the database user's read/write permissions.",
  MONGO_DNS_FAILED: "MongoDB DNS lookup failed. Check DNS, network access, and the configured cluster address.",
  MONGO_NETWORK_FAILED: "Cannot reach MongoDB. Check network/VPN/firewall settings and Atlas Network Access.",
  MONGO_TIMEOUT: "MongoDB connection timed out. Check network access and the Atlas IP access list.",
  MONGO_TLS_FAILED: "MongoDB TLS connection failed. Check certificates and network settings.",
  MONGO_CONNECT_FAILED: "MongoDB connection failed. Check configuration and database availability.",
  ADMIN_LOOKUP_FAILED: "Could not check whether the administrator exists. No account was created.",
  PASSWORD_HASH_FAILED: "Could not hash the password. No account was created.",
  ADMIN_SAVE_FAILED: "Could not save the administrator. No existing account was overwritten; check database access before retrying.",
  DISCONNECT_FAILED: "Administrator was created, but the database connection could not be closed. Do not recreate the account.",
};

class ProvisioningError extends Error {
  constructor(code) {
    super(messages[code]);
    this.code = code;
  }
}

// Inspect driver errors privately. Only fixed messages ever reach the terminal;
// raw errors can include a MongoDB URI, password, or duplicate-key values.
function safeDatabaseError(error, stage) {
  if (error instanceof ProvisioningError) return error;
  const codes = new Set(), details = [], seen = new Set();
  function inspect(value, depth = 0) {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 6) return;
    seen.add(value);
    codes.add(value.code);
    details.push(value.name || "", value.message || "");
    for (const key of ["cause", "reason", "error", "errorResponse"]) inspect(value[key], depth + 1);
    if (value.servers instanceof Map) {
      for (const server of value.servers.values()) inspect(server, depth + 1);
    }
  }
  inspect(error);
  const detail = details.join(" ");
  let code;
  if (codes.has(11000)) code = "ADMIN_EXISTS";
  else if (codes.has(18) || /authentication failed|bad auth|auth failed/i.test(detail)) code = "MONGO_AUTH_FAILED";
  else if (codes.has(13)) code = "MONGO_PERMISSION_DENIED";
  else if (/MongoParseError|invalid (?:scheme|connection string)|Invalid URL/i.test(detail)) code = "MONGO_URI_INVALID";
  else if (/querySrv|queryTxt|ENOTFOUND|EAI_AGAIN/i.test(detail)) code = "MONGO_DNS_FAILED";
  else if (/certificate|TLS|SSL/i.test(detail)) code = "MONGO_TLS_FAILED";
  else if (/ECONNREFUSED|ENETUNREACH|ECONNRESET/i.test(detail)) code = "MONGO_NETWORK_FAILED";
  else if (/timed out|ETIMEDOUT|ServerSelectionError/i.test(detail)) code = "MONGO_TIMEOUT";
  else code = { connect: "MONGO_CONNECT_FAILED", lookup: "ADMIN_LOOKUP_FAILED", hash: "PASSWORD_HASH_FAILED", save: "ADMIN_SAVE_FAILED" }[stage] || "MONGO_CONNECT_FAILED";
  return new ProvisioningError(code);
}

function loadConfiguration({ config = require("dotenv").config, env = process.env } = {}) {
  const result = config({ path: require("node:path").resolve(__dirname, "../.env"), quiet: true, processEnv: env });
  if (!env.MONGO_URI) {
    if (result?.error && result.error.code !== "ENOENT") throw new ProvisioningError("ENV_READ_FAILED");
    throw new ProvisioningError("MONGO_URI_MISSING");
  }
  if (!/^mongodb(?:\+srv)?:\/\/\S+$/.test(env.MONGO_URI)) {
    throw new ProvisioningError("MONGO_URI_INVALID");
  }
}

// The database operation is separate from terminal input so it can be tested
// offline. There is intentionally no HTTP endpoint for admin creation.
const createAdmin = async ({ email, password }, dependencies = { mongoose, bcrypt, Admin }) => {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new ProvisioningError("INVALID_EMAIL");
  if (typeof password !== "string" || password.length < 12) throw new ProvisioningError("PASSWORD_TOO_SHORT");
  if (Buffer.byteLength(password, "utf8") > 72) throw new ProvisioningError("PASSWORD_TOO_LONG");
  let stage = "connect", failure;
  try {
    await dependencies.mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
    stage = "lookup";
    if (await dependencies.Admin.findOne({ email: normalizedEmail })) {
      throw new ProvisioningError("ADMIN_EXISTS");
    }
    stage = "hash";
    const hash = await dependencies.bcrypt.hash(password, 12);
    stage = "save";
    await dependencies.Admin.create({ email: normalizedEmail, password: hash });
  } catch (error) {
    failure = safeDatabaseError(error, stage);
    throw failure;
  } finally {
    try {
      await dependencies.mongoose.disconnect();
    } catch {
      if (!failure) throw new ProvisioningError("DISCONNECT_FAILED");
    }
  }
};

const promptCredentials = async () => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new ProvisioningError("INTERACTIVE_REQUIRED");
  }
  const emailReader = readline.createInterface({ input: process.stdin, output: process.stdout });
  let email;
  try {
    email = await emailReader.question("Administrator email: ");
  } finally {
    emailReader.close();
  }
  // readline controls terminal echo; its output is discarded while entering
  // passwords, including redraws/backspace. No credential goes to stdout.
  const silentOutput = new Writable({ write(chunk, encoding, callback) { callback(); } });
  const secrets = readline.createInterface({ input: process.stdin, output: silentOutput, terminal: true });
  const abort = new AbortController();
  secrets.on("SIGINT", () => { abort.abort(); secrets.close(); });
  try {
    process.stdout.write("Password (hidden, at least 12 characters): ");
    const password = await secrets.question("", { signal: abort.signal });
    process.stdout.write("\nConfirm password (hidden): ");
    const confirmation = await secrets.question("", { signal: abort.signal });
    process.stdout.write("\n");
    if (password !== confirmation) throw new ProvisioningError("PASSWORD_MISMATCH");
    return { email, password };
  } finally {
    secrets.close();
    silentOutput.end();
  }
};

const main = async () => {
  if (process.argv.length !== 2) {
    console.error("Run npm run create-admin without credential arguments.");
    process.exitCode = 1;
    return;
  }
  let credentials;
  try {
    credentials = await promptCredentials();
  } catch (error) {
    const safe = error instanceof ProvisioningError ? error : new ProvisioningError("CANCELLED");
    console.error(`[${safe.code}] ${safe.message}`);
    process.exitCode = 1;
    return;
  }
  try {
    loadConfiguration();
  } catch (error) {
    const safe = error instanceof ProvisioningError ? error : new ProvisioningError("ENV_READ_FAILED");
    console.error(`[${safe.code}] ${safe.message}`);
    process.exitCode = 1;
    return;
  }
  try {
    await createAdmin(credentials);
    console.log("Administrator created successfully.");
  } catch (error) {
    const safe = safeDatabaseError(error);
    console.error(`[${safe.code}] ${safe.message}`);
    process.exitCode = 1;
  }
};

if (require.main === module) main();
module.exports = { createAdmin, loadConfiguration, safeDatabaseError };
