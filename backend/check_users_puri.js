require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const db = mongoose.connection;
    const users = await db.collection('users').find({ name: { $regex: /puri/i } }).toArray();
    console.log("Users matching 'puri':");
    users.forEach(u => console.log(`- ${u.name} (Role: ${u.role}, Verified: ${u.isVerified})`));
    
    const result = await db.collection('users').deleteMany({ name: { $regex: /puri/i } });
    console.log(`Deleted ${result.deletedCount} users matching puri.`);
    process.exit(0);
}).catch(e => {
    console.error(e);
    process.exit(1);
});
