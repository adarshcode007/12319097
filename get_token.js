import dotenv from 'dotenv';
dotenv.config();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const AUTH_URL = 'http://4.224.186.213/evaluation-service/auth';

async function getAccessToken() {
    try {
        const response = await fetch(AUTH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                clientID: CLIENT_ID,
                clientSecret: CLIENT_SECRET,
                email: 'adarsh19pandey@gmail.com',
                name: 'adarsh kumar pandey',
                rollNo: '12319097',
                accessCode: 'TRvZWq'
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('Auth failed:', response.status, error);
            return;
        }

        const data = await response.json();
        console.log('NEW_TOKEN:' + data.access_token);
    } catch (err) {
        console.error('Error fetching token:', err.message);
    }
}

getAccessToken();
