import { OAuth2Client } from 'google-auth-library';
import express from 'express';
import path from 'path';

// Configuration read from environment variables
const CLIENT_ID = process.env.CLIENT_ID || '';
const PORT = process.env.PORT || 8080;

const app = express();
app.set('views', path.join(process.cwd(), 'static'));
app.set('view engine', 'ejs');
const client = new OAuth2Client(CLIENT_ID);

/**
 * Returns the userId, or <nil> if login was unsuccessful.
 *
 * @param userToken The user's JWT.
 */
async function verify(userToken: string): Promise<string | null> {
  try {
    const ticket = await client.verifyIdToken({
      idToken: userToken,
      audience: CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload) {
      return null;
    }
    return payload['sub'];
  } catch (e) {
    console.log('Failed to validate JWT: ' + e);
    return null;
  }
}



app.get('/', (req, res) => {
  res.render('main', { CLIENT_ID: CLIENT_ID });
  // res.sendFile(path.join(process.cwd(), 'static', 'main.html'));
  console.log(`Currently in ${process.cwd()}`);
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
    console.log("You must set $CLIENT_ID or the application will not work.");
    process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Server started on ${PORT}`);
});
