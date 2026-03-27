require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const db = mongoose.connection;
    const rests = await db.collection('restaurants').find({}).toArray();
    console.log("All Restaurants in DB:");
    rests.forEach(r => console.log(`- ${r.name} (ID: ${r._id}, Owner: ${r.owner})`));

    const result = await db.collection('restaurants').deleteMany({ name: { $regex: /puri/i } });
    console.log(`\nDeleted ${result.deletedCount} restaurants matching "Puri".`);
    process.exit(0);
}).catch(e => {
    console.error(e);
    process.exit(1);
});
