// isharePlace/Ishare.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');
const xml2js = require('xml2js');
const mongoose = require('mongoose');
const auth = require('../AuthMiddle/middlewareauth');
const { Order, User, Transaction } = require('../schema/schema');

const router = express.Router();


const ISHARE_URL = 'http://41.215.168.146/FlexiShareBundles.asmx';

// const ISHARE_URL = 'http://41.215.168.146/FlexiShareBundles.asmx';
const ISHARE_USERNAME = 'OliverElVen';
const ISHARE_PASSWORD = '6f44b24edb465edc97f192bab7a67d23';
const DEALER_MSISDN = '0270054322';

/**
 * Function to send a SOAP request to iShare with retry mechanism
 */
async function sendSoapRequest(xml, action, retries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`SOAP request attempt ${attempt}/${retries}`);
            
            const response = await axios.post(ISHARE_URL, xml, {
                headers: {
                    'Content-Type': 'text/xml;charset=UTF-8',
                    'SOAPAction': `http://tempuri.org/${action}`,
                },
                timeout: 15000, // 15 seconds timeout
                httpsAgent: new https.Agent({ 
                    rejectUnauthorized: false // Only use in development for self-signed certs
                })
            });
            
            return await xml2js.parseStringPromise(response.data, { explicitArray: false });
        } catch (error) {
            console.error(`SOAP request attempt ${attempt} failed:`, error.message);
            lastError = error;
            
            // Only retry on network errors, not on 4xx/5xx responses
            if (!error.isAxiosError || error.response) {
                throw error;
            }
            
            // Wait before retrying (exponential backoff)
            if (attempt < retries) {
                const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s...
                console.log(`Retrying in ${delay/1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    // If all retries failed
    throw lastError;
}

/**
 * @route   POST /api/orders/placeorder
 * @desc    Place an order for an AT-iShare bundle
 * @access  Private
 */
router.post('/placeorder', auth, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const { recipientNumber, capacity, price, bundleType } = req.body;

        // Validate required fields
        if (!recipientNumber || !capacity || !price || !bundleType) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        // Ensure bundleType is "AT-iShare"
        if (bundleType !== 'AT-ishare') {
            return res.status(400).json({ success: false, message: 'Invalid bundle type. Must be AT-ishare' });
        }

        // Get user for wallet balance check
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Check if user has enough balance
        if (user.wallet.balance < price) {
            return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
        }

        // Generate a unique transaction ID
        const transactionId = `ISHARE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        // Create SOAP request for iShare API
        const xmlRequest = `
            <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
                <soapenv:Header/>
                <soapenv:Body>
                    <tem:FlexiIshareBundle>
                        <tem:username>${ISHARE_USERNAME}</tem:username>
                        <tem:password>${ISHARE_PASSWORD}</tem:password>
                        <tem:dealerMsisdn>${DEALER_MSISDN}</tem:dealerMsisdn>
                        <tem:recipientMsisdn>${recipientNumber}</tem:recipientMsisdn>
                        <tem:transactionId>${transactionId}</tem:transactionId>
                        <tem:sharedBundle>${capacity}</tem:sharedBundle>
                    </tem:FlexiIshareBundle>
                </soapenv:Body>
            </soapenv:Envelope>`;

        try {
            // Call iShare API with 
            const result = await sendSoapRequest(xmlRequest, 'FlexiIshareBundle');
            const responseMessage = result['soap:Envelope']['soap:Body']['FlexiIshareBundleResponse']['FlexiIshareBundleResult']['ApiResponse']['ResponseMsg'];

            if (responseMessage !== 'Crediting Successful.') {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ success: false, message: 'Failed to process order with iShare', responseMessage });
            }

            // Create order in database
            const newOrder = new Order({
                user: req.user.id,
                bundleType,
                capacity,
                price,
                recipientNumber,
                status: 'completed',
                transactionId,
                updatedAt: Date.now()
            });

            await newOrder.save({ session });

            // Create transaction record
            const transaction = new Transaction({
                user: req.user.id,
                type: 'purchase',
                amount: price,
                description: `Bundle purchase: ${capacity}MB for ${recipientNumber}`,
                status: 'completed',
                reference: transactionId,
                orderId: newOrder._id,
                balanceBefore: user.wallet.balance,
                balanceAfter: user.wallet.balance - price,
                paymentMethod: 'wallet'
            });

            await transaction.save({ session });

            // Deduct from user's wallet
            user.wallet.balance -= price;
            user.wallet.transactions.push(transaction._id);
            await user.save({ session });

            // Commit the transaction
            await session.commitTransaction();
            session.endSession();

            res.status(201).json({
                success: true,
                message: 'Order placed successfully and data transferred via iShare',
                order: {
                    id: newOrder._id,
                    transactionId,
                    recipientNumber,
                    bundleType,
                    capacity,
                    price,
                    status: newOrder.status,
                    createdAt: newOrder.createdAt
                },
                walletBalance: user.wallet.balance
            });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            
            // Check for network connectivity issues and provide friendly message
            if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                console.error('Network connectivity issue with AT-iShare service:', error);
                return res.status(503).json({ 
                    success: false, 
                    message: 'AT-iShare service is currently unavailable. Please try again later.' 
                });
            }
            
            throw error;
        }

    } catch (error) {
        // If transaction is still active, abort it
        if (session.inTransaction()) {
            await session.abortTransaction();
            session.endSession();
        }
        
        console.error('Error placing AT-iShare order:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error processing your order', 
            error: error.message 
        });
    }
});

module.exports = router;