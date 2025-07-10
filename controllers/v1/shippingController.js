import db from '../../config/db.js';
import parsePhoneNumber from 'libphonenumber-js';
import { getCode, getData, getNameList } from 'country-list';

export const addShippingAddress = async (req, res) => {
    try {
        const userId = req.user.id;
        const { line1, line2, city, state, postal_code, country, phone } = req.body;

        if (!line1 || !city || !postal_code || !country || !phone) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required',
            });
        }

        
        // Validate country and get country code
        // console.log(getData());
        const code = getCode(country);
        if (!code) {
          return res.status(400).json({
            success: false,
            message: "Invalid country. Please use full country name.",
          });
        }

        // Validate and format phone number
        let formattedPhone;
        try {
            const phoneNumber = parsePhoneNumber(phone, code);
            if (!phoneNumber.isValid()) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid phone number for selected country',
                });
            }

            formattedPhone = phoneNumber.format('E.164');
        } catch (phoneErr) {
            return res.status(400).json({
                success: false,
                message: 'Invalid phone number format',
            });
        }

        // Validate line1
        if (line1.trim().length < 3) {
            return res.status(400).json({
                success: false,
                message: 'Address line 1 must be at least 3 characters long',
            });
        }

        // Validate city
        if (city.trim().length < 2) {
            return res.status(400).json({
                success: false,
                message: 'City must be at least 2 characters long',
            });
        }

        if (postal_code.trim().length < 3) {
            return res.status(400).json({
                success: false,
                message: 'Postal code must be at least 3 characters long',
            });
        }

        // Save shipping address to database
        const result = await db.query(
          `
                INSERT INTO addresses (user_id, line1, line2, city, state, postal_code, country, phone)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
            `,
          [
            userId,
            line1.trim(),
            line2?.trim() || null,
            city.trim(),
            state?.trim() || null,
            postal_code.trim().toUpperCase(),
            code,
            formattedPhone,
          ]
        );

        const newAddress = result.rows[0];

        res.status(201).json({
            success: true,
            message: "Shipping address added successfully",
            shipping_address: newAddress
        })
    } catch (err) {
        console.log("Error adding shipping address:", err);
        res.status(500).json({
            success: false,
            message: 'Server Error',
            error: err.message,
        });
    }
};

export const getUserShippingAddresses = async (req, res) => {
    try {
        const userId = req.user.id;

        const result = await db.query(
            `SELECT * FROM addresses WHERE user_id = $1`,
            [userId]
        );
        
        res.status(200).json({
            success: true,
            message: result.rows.length > 0 ? 'Shipping addresses retrieved successfully' : 'No shipping address found',
            shipping_addresses: result.rows || []
        });
    } catch (err) {
        console.log("Error getting user shipping addresses:", err);
        res.status(500).json({
            success: false,
            message: "Failed to get shipping addresses",
            error: err.message
        });
    }
}

export const getShippingAddress = async (req, res) => {
    try {
        const userId = req.user.id;
        const addressId = req.params.id;

        const result = await db.query(
            "SELECT * FROM addresses WHERE id = $1 AND user_id = $2", 
            [addressId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Shipping address not found",
            })
        }

        res.status(200).json({
            success: true,
            message: "Shipping address retrieved successfully",
            shipping_address: result.rows[0]
        })
    } catch (err) {
        console.log("Error getting shipping address:", err);
        res.status(500).json({
            success: false,
            message: 'Failed to get shipping address',
            error: err.message
        });
    }
}

export const updateShippingAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const shipping_address_id = req.params.id;
    const updates = req.body;

    if (!shipping_address_id) {
        return res.status(400).json({
            success: false,
            message: "Shipping Address ID is required"
        });
    }

    // Get existing shipping address
    const existingShippingAddr = await db.query(
        "SELECT * FROM addresses WHERE id = $1 AND user_id = $2", 
        [shipping_address_id, userId]
    );

    if (existingShippingAddr.rows.length === 0) {
        return res.status(404).json({
            success: false,
            message: "Shipping address not found"
        });
    }

    // Define allowed fields
    const allowedFields = [
      "line1",
      "line2",
      "city",
      "state",
      "postal_code",
      "country",
      "phone",
    ];
    const allowedUpdates = {};

    // Filter only allowed fields
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && value !== undefined && value !== "") {
        allowedUpdates[key] = value;
      }
    }

    // const data = getNameList();
    // console.log('Country names:', data);

    // Validate country and get country code
    let code = existingShippingAddr.rows[0].country;

    if (allowedUpdates.country) {
      code = getCode(allowedUpdates.country.trim());
      if (!code) {
        return res.status(400).json({
          success: false,
          message: "Invalid country. Please use full country name.",
        });
      }

      let warningMessage = null; 
      if (!allowedUpdates.phone) {
        // Initialize warning message

        try {
          // Check if phone number is valid for the new country
          const phoneNumber = parsePhoneNumber(
            existingShippingAddr.rows[0].phone,
            code
          );

          if (phoneNumber.country !== code) {
            warningMessage = {
              title: "Phone number compatibility warning",
              message: `Your current phone number (${
                existingShippingAddr.rows[0].phone
              }) may not be compatible with ${allowedUpdates.country.trim()}.`,
              impacts: [
                "International calling costs for delivery notifications",
                `Inability to receive local SMS in ${allowedUpdates.country.trim()}`,
                "Delivery issues if courier needs to contact you",
              ],
              recommendation:
                "Consider updating your phone number for better delivery experience.",
            };
          }
        } catch (phoneErr) {
          // If parsing fails, it's likely incompatible with the new country
         warningMessage = {
              title: "Phone number compatibility warning",
              message: `Your current phone number (${
                existingShippingAddr.rows[0].phone
              }) may not be compatible with ${allowedUpdates.country.trim()}.`,
              impacts: [
                "International calling costs for delivery notifications",
                `Inability to receive local SMS in ${allowedUpdates.country.trim()}`,
                "Delivery issues if courier needs to contact you",
              ],
              recommendation:
                "Consider updating your phone number for better delivery experience.",
            };
        }

        req.phoneWarning = warningMessage;
      }

      allowedUpdates.country = code; // Store country code
    }

    // Validate and format phone number
    if (allowedUpdates.phone) {
        const phoneValidationCountry = allowedUpdates.country ? code : existingShippingAddr.rows[0].country;
      try {
        const phoneNumber = parsePhoneNumber(allowedUpdates.phone, phoneValidationCountry);
        if (!phoneNumber.isValid()) {
          return res.status(400).json({
            success: false,
            message: "Invalid phone number for selected country",
          });
        }
        
        allowedUpdates.phone = phoneNumber.format("E.164");
      } catch (phoneErr) {
        return res.status(400).json({
          success: false,
          message: "Invalid phone number format",
        });
      }
    }

    // Validate line1
    if (allowedUpdates.line1) {
      if (allowedUpdates.line1.trim().length < 3) {
        return res.status(400).json({
          success: false,
          message: "Address line 1 must be at least 3 characters long",
        });
      }
      allowedUpdates.line1 = allowedUpdates.line1.trim();   
    }

    // Validate city
    if (allowedUpdates.city) {
      if (allowedUpdates.city.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "City must be at least 2 characters long",
        });
      }
      allowedUpdates.city = allowedUpdates.city.trim();
    }

    // Validate postal code
    if (allowedUpdates.postal_code) {
      if (allowedUpdates.postal_code.trim().length < 3) {
        return res.status(400).json({
          success: false,
          message: "Postal code must be at least 3 characters long",
        });
      }
        allowedUpdates.postal_code = allowedUpdates.postal_code.trim().toUpperCase();
    }

    // Trim line2 and state if provided
    if (allowedUpdates.line2) {
      allowedUpdates.line2 = allowedUpdates.line2.trim() || null; // Allow empty string to be set to null
    }

    if (allowedUpdates.state) {
      allowedUpdates.state = allowedUpdates.state.trim() || null; // Allow empty string to be
    }

    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
      });
    }

    // Dynamic sql query
    const fields = Object.keys(allowedUpdates);
    const values = Object.values(allowedUpdates);
    const setClause = fields
      .map((field, index) => `${field} = $${index + 1}`)
      .join(", ");

    const query = `
      UPDATE addresses SET ${setClause}, updated_at = NOW() WHERE id = $${
      fields.length + 1
    } AND user_id = $${fields.length + 2}
      RETURNING *
      `;

    // Update shipping address
    const result = await db.query(query, [...values, shipping_address_id, userId]);

    const response = {
      success: true,
      message: "Shipping address updated successfully",
      shipping_address: result.rows[0],
    };

    // Add warning if phone number might be incompatible with new country
    if (req.phoneWarning) {
        response.warning = req.phoneWarning;
    }

    res.status(200).json(response);
  } catch (err) {
    console.log("Error Updating Shipping address:", err);
    res.status(500).json({
      success: false,
      message: "Failed to update shipping address",
      error: err.message,
    });
  }
};

export const deleteShippingAddress = async (req, res) => {
    try {
        const userId = req.user.id
        const shipping_address_id = req.params.id

        const result = await db.query(
            "DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING *", 
            [shipping_address_id, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Shipping address not found"
            });
        }
        res.status(200).json({
            success: true,
            message: "Shipping address deleted successfully",
            deleted_shipping_address: result.rows[0]
        });
    } catch (err) {
        console.log("Error deleting shipping address:", err);
        res.status(500).json({
            success: false,
            message: "Failed to delete shipping address",
            error: err.message,
        });
    }
}