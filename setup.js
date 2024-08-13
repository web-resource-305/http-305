/* eslint-disable no-console */
const fs = require("fs");
const path = ".env";

const envContent = `
# Add your environment variables here
`;

if (!fs.existsSync(path)) {
  fs.writeFileSync(path, envContent, { flag: "wx" });
  console.log(".env file created successfully.");
} else {
  console.log(".env file already exists.");
}
