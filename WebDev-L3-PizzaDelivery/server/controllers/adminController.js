const Admin = require("../models/Admin");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const adminProfile = (admin) => ({ id: admin._id, email: admin.email, role: "admin" });

const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
      return res.status(400).json({ message: "Please enter email and password" });
    }
    const admin = await Admin.findOne({ email: email.trim().toLowerCase() });
    if (!admin || !(await bcrypt.compare(password, admin.password))) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET, {
      subject: String(admin._id), expiresIn: "1d", algorithm: "HS256",
    });
    return res.json({ message: "Login successful", token, admin: adminProfile(admin) });
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

const getCurrentAdmin = (req, res) => res.json({ admin: adminProfile(req.identity) });
module.exports = { loginAdmin, getCurrentAdmin };
