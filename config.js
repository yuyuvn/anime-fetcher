// If modifying these scopes, delete credentials.json.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const DATA_DIR = process.env.DATA_DIR || 'data';
const TOKEN_PATH = `${DATA_DIR}/token.json`;
const CLIENT_SECRET_PATH = `${DATA_DIR}/client_secret.json`;
const PORT = process.env.PORT || 5321
const DOMAIN = process.env.DOMAIN || `http://localhost:${PORT}`

export { SCOPES, DATA_DIR, TOKEN_PATH, CLIENT_SECRET_PATH, PORT, DOMAIN }
