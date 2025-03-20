const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
const { User, Transaction } = require("../schema/schema");
const authMiddleware = require("../AuthMiddle/middlewareauth"); // Import the auth middleware

dotenv.config();
const router = express.Router();

// Use environment variable instead of hardcoded key
const PAYSTACK_SECRET_KEY = 'sk_live_3dcaf1a28ed77172796e90843a6b86ff9cef4a6c';

if (!PAYSTACK_SECRET_KEY) {
  throw new Error("Paystack secret key is missing in environment variables");
}

// Apply auth middleware to all wallet routes
router.use(authMiddleware);

// Initialize Paystack Payment - Getting userId from authenticated user
router.post("/wallet/add-funds", async (req, res) => {
  try {
    // Get userId from req.user.id that was set by the auth middleware
    const userId = req.user.id;
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({ success: false, error: "Amount is required" });
    }

    // Fetch user from database to get email
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const email = user.email;

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: amount * 100, // Convert to kobo (smallest unit)
        currency: "GHS", 
        callback_url: `https://bignsah.vercel.app/verify-payment`,
        metadata: {
          userId: userId,
          custom_fields: [
            {
              display_name: "User ID",
              variable_name: "user_id",
              value: userId
            }
          ]
        }
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    // Create a pending transaction record
    const transaction = new Transaction({
      user: userId, // Using 'user' field from schema
      type: 'deposit',
      amount,
      currency: "GHS",
      reference: response.data.data.reference,
      status: 'pending',
      description: 'Wallet funding via Paystack',
      balanceBefore: user.wallet.balance,
      balanceAfter: user.wallet.balance, // Will be updated after confirmation
    });
    
    await transaction.save();

    return res.json({ 
      success: true, 
      authorizationUrl: response.data.data.authorization_url,
      reference: response.data.data.reference
    });
  } catch (error) {
    console.error("Error initializing Paystack payment:", error);
    return res.status(500).json({ success: false, error: "Failed to initialize payment" });
  }
});

// Verify Payment & Credit Wallet
// This endpoint doesn't use authentication middleware since it's called by Paystack
router.get("/wallet/verify-payment", async (req, res) => {
  try {
    const { reference } = req.query;

    if (!reference) {
      return res.status(400).json({ success: false, error: "Missing payment reference" });
    }

    // Verify payment
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    });

    if (response.data.data.status === "success") {
      const { email, amount, metadata } = response.data.data;
      
      console.log("Paystack response data:", response.data.data);
      
      // Find the user and update wallet balance
      let user;
      
      if (metadata && metadata.userId) {
        user = await User.findById(metadata.userId);
        console.log("Looking up user by ID:", metadata.userId);
      } 
      
      // Fallback to email lookup
      if (!user) {
        user = await User.findOne({ email: { $regex: new RegExp('^' + email + '$', 'i') } });
        console.log("Looking up user by email:", email);
      }

      if (!user) {
        console.log("User not found with email:", email);
        return res.status(404).json({ success: false, error: "User not found" });
      }

      // Update wallet balance
      const amountInGHS = amount / 100; // Convert from kobo
      const oldBalance = user.wallet.balance || 0;
      const newBalance = oldBalance + amountInGHS;
      user.wallet.balance = newBalance;
      
      // Add transaction to user's wallet transactions array
      const transaction = new Transaction({
        user: user._id,
        type: 'deposit',
        amount: amountInGHS,
        currency: "GHS",
        reference,
        status: 'completed',
        description: 'Wallet funding via Paystack',
        balanceBefore: oldBalance,
        balanceAfter: newBalance,
        paymentMethod: 'Paystack',
        paymentDetails: response.data.data
      });
      
      // Save transaction and add to user's transactions array
      const savedTransaction = await transaction.save();
      user.wallet.transactions.push(savedTransaction._id);
      
      // Save user with updated wallet
      await user.save();

      return res.json({ 
        success: true, 
        message: "Wallet funded successfully", 
        balance: user.wallet.balance 
      });
    } else {
      return res.status(400).json({ success: false, error: "Payment verification failed" });
    }
  } catch (error) {
    console.error("Error verifying Paystack payment:", error);
    return res.status(500).json({ success: false, error: "Payment verification failed" });
  }
});

// Get wallet balance
router.get("/wallet/balance", async (req, res) => {
  try {
    // Get userId from req.user.id that was set by the auth middleware
    const userId = req.user.id;

    // Find the user and get their wallet balance
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // Return the wallet balance
    return res.json({
      success: true,
      balance: user.wallet.balance || 0,
      currency: user.wallet.currency || "GHS"
    });
  } catch (error) {
    console.error("Error fetching wallet balance:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch wallet balance" });
  }
});

// Get Wallet Transaction History
router.get("/wallet/transactions", async (req, res) => {
  try {
    // Get userId from req.user.id that was set by the auth middleware
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;

    // Find transactions for this user
    const transactions = await Transaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const count = await Transaction.countDocuments({ user: userId });

    return res.json({
      success: true,
      transactions,
      totalPages: Math.ceil(count / limit),
      currentPage: page
    });
  } catch (error) {
    console.error("Error fetching transaction history:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch transaction history" });
  }
});

module.exports = router;