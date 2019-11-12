"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const google_auth_library_1 = require("google-auth-library");
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
// Configuration read from environment variables
const CLIENT_ID = process.env.CLIENT_ID || '';
const PORT = process.env.PORT || 8080;
const app = express_1.default();
app.set('views', path_1.default.join(process.cwd(), 'static'));
app.set('view engine', 'ejs');
const client = new google_auth_library_1.OAuth2Client(CLIENT_ID);
/**
 * Returns the userId, or <nil> if login was unsuccessful.
 *
 * @param userToken The user's JWT.
 */
async function verify(userToken) {
    try {
        const ticket = await client.verifyIdToken({
            idToken: userToken || "",
            audience: CLIENT_ID,
        });
        const payload = ticket.getPayload();
        if (!payload) {
            return null;
        }
        return payload['sub'];
    }
    catch (e) {
        console.log('Failed to validate JWT: ' + e);
        return null;
    }
}
app.get('/', (req, res) => {
    res.render('main', { CLIENT_ID: CLIENT_ID });
});
app.get('/wheel.jpg', (req, res) => {
    res.sendFile(path_1.default.join(process.cwd(), 'static', 'wheel.jpg'));
});
app.post('/signin', (req, res) => {
    let user = verify(req.get('Authorization'));
    res.send(`Hello ${user}`);
});
/*app.all('/', (req, res) => {
    console.log(`All ${req}`);
    res.send(`Yay`);
})
app.get('/', (req, res) => {
  console.log(`Got ${req}`);
  res.send(`Thanks!`);
});
*/
if (!CLIENT_ID) {
    console.log('You must set $CLIENT_ID or the application will not work.');
    process.exit(1);
}
app.listen(PORT, () => {
    console.log(`Server started on ${PORT}`);
});
//# sourceMappingURL=index.js.map