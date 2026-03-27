require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const result = await mongoose.connection.collection('users').deleteMany({ role: 'vendor', isVerified: false });
    
    // delete ONLY restaurants that don't have a valid 'owner' user Document
    const users = await mongoose.connection.collection('users').find({}).toArray();
    const userIds = users.map(u => String(u._id));
    
    const rests = await mongoose.connection.collection('restaurants').find({}).toArray();
    let deletedRests = 0;
    for (let r of rests) {
        if (!r.owner || !userIds.includes(String(r.owner))) {
            await mongoose.connection.collection('restaurants').deleteOne({ _id: r._id });
            deletedRests++;
        }
    }
    console.log('Cleaned up:', result.deletedCount, 'unverified users and', deletedRests, 'dangling restaurants.');
    process.exit(0);
});
