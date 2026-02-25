const express = require('express');
const app = express();
const bodyParser = require('body-parser');

const PORT = 5001;

app.use(bodyParser.json());

let doctors = [

    {
        id: "D001",
        name: "Dr. Sample Name",
        specialty: "Cardiology",
        slots: 5,

    },

    {
        id: "D002",
        name: "Dr. Jane Doe",
        specialty: "Dermatology",
        slots: 3,
    },

    {
        id: "D003",
        name: "Dr. John Smith",
        specialty: "Pediatrics",
        slots: 4,
    }

];

app.get('/doctors', (req, res) => {
    res.json(doctors);
});

app.get('/doctors/:id', (req,res) => {
    const doctor = doctors.find(d => d.id === req.params.id);

    if(!doctor) {
        return res.status(404).json({ message: 'Doctor not found'});
    }

    res.json(doctor);
});

app.post('/doctors/:id/reserve', (req, res) => {
    const doctor = doctors.find(d => d.id === req.params.id);

    if(!doctor) {
        return res.status(404).json({ message: 'Doctor not found'});
    }

    if(doctor.slots <= 0) {
        return res.status(409).json({ 
            "success": false,
            "reason": `${doctor.name} has no available slots`
        });
    }
    
    doctor.slots -= 1;
    res.json({ 
        "success": true,
        "doctor_id": doctor.id,
        "doctor_name": doctor.name,
        "slots_remaining": doctor.slots
    });
   
});