// ============================================================
// CONFIGURATION
// ============================================================

export const BASES = {
  addons: 'appgvcig9jwAhim6W',
  invitations: 'appgvcig9jwAhim6W',
  tickets: 'appgvcig9jwAhim6W',
  syncState: 'appgvcig9jwAhim6W',
};

export const TABLES = {
  addons: 'tblgcN9VlJ4jT5R2h',       // Add-Ons
  invitations: 'tblKgwXnpqWjf8Z8q',  // Invitations
  tickets: 'tblVGGdO9QrRYi50x',      // BSS'26
  syncState: 'tblT06K1k450mZ6q2',    // {{Sync State}}
};

// The Airtable field ID used to uniquely identify each SP record (upsert merge key)
export const MERGE_FIELDS = {
  addons: 'fldP1ir0aTTKnE4bx',       // SP ID
  invitations: 'fldFBesn9Xnq5TM3d',  // SP ID
  tickets: 'fldq44PIoUKPDHh6m',      // SP ID
};

// Sync State table field IDs — used by airtable.js getCursor / logSync
export const SYNC_STATE_FIELDS = {
  endpoint:           'fldAo1psPukG3sQ1h', // Endpoint
  cursor:             'fldvBpePE7mnRrVDP', // Cursor
  triggeredBy:        'fldEItJaRgt9VPVK8', // Triggered By
  syncedAt:           'fld9aDm40gw6cBGnR', // Synced At
  status:             'fldWBdEoxTp6h8nfg', // Status
  error:              'fldLlLrqoEG6j4boI', // Error
  recordsFetched:     'fldRcckVEjGONXEaR', // Records Fetched
  invitationsCreated: 'fldGDBLEfUhqE75sW', // Invitations Created
  invitationsUpdated: 'fldjitUvHM6tSVwae', // Invitations Updated
  ticketsCreated:     'fldwWYgSXESA2KgCG', // Tickets Created
  ticketsUpdated:     'fldgkyq5nuTPsU7x3', // Tickets Updated
  addonsCreated:      'fldW9JzB45S6hUvP2', // Add-Ons Created
  addonsUpdated:      'fldC8EK7KrlLNMs4j', // Add-Ons Updated
};

// Field mapping: Secret Party API field → Airtable field ID
// Nested fields use dot notation: 'product.name' → resolved via nested object traversal
export const FIELD_MAP = {
  addons: {
    id:                             'fldP1ir0aTTKnE4bx', // SP ID
    code:                           'fldljYwmabwfRZGnH', // Add-on Code
    invitation_code:                'fldTxbTWCDu8niD1x', // Invitation Code
    invitation_id:                  'fld4WsRmoGW3YrPH2', // SP Invitation ID
    first_name:                     'fldzbyMhjaZ5xnT4S', // SP First Name
    last_name:                      'fldXpymlAD0XEQ4cl', // SP Last Name
    email:                          'fldoAzpdEEBGwZevF', // Email from SP
    phone:                          'fldxUeLMndhP0n0bJ', // SP Phone
    stage:                          'flduCGSqF03RLvkye', // SP Stage
    status:                         'fldPSH5a7Ceybw2rj', // SP Status
    invites_per:                    'fldSAvAgVbJ9F12it', // SP Invites Per
    purchase_price:                 'fldBASNY9tFgDk0zH', // SP Purchase Price
    surcharge_fee:                  'fldPtUL6ssQ947Ops', // SP Surcharge Fee
    service_fee:                    'fldf2x2qVMFbeaQBM', // SP Service Fee
    processing_fee:                 'fldEN2czJ9ji73Gzi', // SP Processing Fee
    total:                          'fldhYgOWPN1lgNFiK', // SP Total
    transfer_fee:                   'fldfhnEMIWX1PeoQ9', // SP Transfer Fee
    transfer_requires_payment:      'fldYOKVAI5FqfzuaW', // SP Transfer Requires Payment
    transfer_status:                'fld6c78vwTFqfycyn', // SP Transfer Status
    transferee_first_name:          'fldTvCUBFwiNgSLQO', // SP Transferee First Name
    transferee_last_name:           'fldAU2uZwEHKMhWbv', // SP Transferee Last Name
    transferee_email:               'fldznohcA7d0yBut7', // SP Transferee Email
    transferer_code:                'fldEfFOuYC1Xo1qVw', // SP Transferer Code
    transferer_first_name:          'fldsna5IOIbEWDqS9', // SP Transferer First Name
    transferer_last_name:           'flde86HiAs9kBrLLE', // SP Transferer Last Name
    transferer_email:               'fld1TF00D0uAGNKxq', // SP Transferer Email
    sales_organizer_revenue_amount: 'fldzhlCuhon53YxCM', // SP Sales Organizer Revenue
    is_checked_in:                  'fldZETh8m9SZotUwy', // SP Is Checked In
    checkin_updated_at:             'fldWGJhnQVDWQ3VvX', // SP Checkin At
    total_unlocked_by_count:        'fldWgsRoxF1xzVasZ', // SP Total Unlocked By Count
    promotion_code:                 'fld37hcwC72lPrdM1', // SP Promo Code
    created_at:                     'fldaDlC1uVLqloCDt', // SP Created At
    updated_at:                     'fldOrbWKqbvWqlULq', // SP Updated At
    // Nested fields
    'product.name':                 'fldXOQFcZEwJqaHlo', // SP Product Name
    'product.type':                 'fld4l79yNBNSb2j9t', // SP Product Type
    'product.is_transfer_allowed':  'fld5hd8EVddFKRwMX', // SP Product Transfer Allowed
    invitation:                     'fldw23tKBMi00v0Ph', // SP Invitation
  },
  invitations: {
    id:                           'fldFBesn9Xnq5TM3d', // SP ID
    code:                         'fldGlaQiv57ukK0gR', // Invite Code
    first_name:                   'fldTtSGX0INmvO5E6', // First Name
    last_name:                    'fldXibxPhBLlp8fFq', // Last Name
    email:                        'fldOQbQ9fgGSBi3NB', // Email
    phone:                        'flddXboICSLGqyeHB', // Phone
    stage:                        'fld5fGBodYHlI3tg7', // SP Stage
    status:                       'fldR9RxW17quHKo0z', // SP Status
    level:                        'fld2Rv0GC8s9RxFKd', // SP Level (number → stored as text)
    invites_per:                  'fldHRepD2EMj3zgbg', // SP Invites Per
    view_count:                   'fldTqLDIZvLmBhdpl', // SP View Count
    created_invitation_count:     'fldB6pRlb69ulLM4f', // SP Created Invitation Count
    claimed_ticket_count:         'fld9O2GmezzFFvlbz', // SP Claimed Ticket Count
    last_viewed_at:               'fldvGWSsJ8V2fR7o1', // SP Last Viewed At
    created_at:                   'fldSft03f0bJwv96o', // SP Created At
    updated_at:                   'fldcVDrwDdNtfcY5z', // SP Updated At
    inviter_email:                'fldVQLWiLHYvMvCnH', // Invited By Email
    // Nested fields
    'inviter.name':               'fldnEWJQkzfw3bfIF', // SP Inviter Name
    'parent_invitation.id':       'fldcrsKeGsXLu5uXw', // SP Parent Invitation ID
    'parent_invitation.code':     'fldgLuci8QixM4xiB', // SP Parent Invitation Code
    tickets:                      'fldxuD67qVhxagtoG', // SP Tickets
  },
  tickets: {
    id:                               'fldq44PIoUKPDHh6m', // SP ID
    code:                             'fldxeLnKcGsno43UB', // Ticket Code
    invitation_code:                  'fldwmE63DUYt3FFbb', // Invitation Code
    invitation_id:                    'fldc5ScY4pcUMbvfZ', // SP Invitation ID
    first_name:                       'fldxp740WpKTgaKOf', // First Name
    last_name:                        'fldGjE8zyLtidaW1D', // Last Name
    email:                            'fld6SaQw5cQJiRnrl', // Email from SP
    phone:                            'fldeYx93gmzrBpmt9', // Phone
    stage:                            'fldqfYrpn6IhRAEEN', // SP Stage
    status:                           'fldKeStz9ICijOATC', // SP Status
    invites_per:                      'fldA4t9YTxepmdmDL', // SP Invites Per
    purchase_price:                   'fldw3RYPnBEjHdDsg', // SP Purchase Price
    total:                            'fldsfMec9iXMHYGlf', // SP Total
    is_checked_in:                    'fld0ofKVH9iefJ1Nk', // SP Is Checked In
    checkin_updated_at:               'fldGkH6zpi05uLRGH', // SP Checkin At
    transfer_status:                  'fldakt0ZJ4SUmgog4', // SP Transfer Status
    transferee_first_name:            'fld0CltH5ZumSIyHb', // SP Transferee First Name
    transferee_last_name:             'fldGG5T0c5kidQT6b', // SP Transferee Last Name
    transferee_email:                 'fldIxzcDStsFQ8Agi', // SP Transferee Email
    transferer_code:                  'fld5TF0StCFA8F3aR', // SP Transferer Code
    transferer_first_name:            'flddbdNxtjtrGsUjr', // SP Transferer First Name
    transferer_last_name:             'fld7vvILUmeZewiIN', // SP Transferer Last Name
    transferer_email:                 'fld86IrgPDBdXNIVK', // SP Transferer Email
    surcharge_fee:                    'fld3sDUrIIBMbU1hH', // SP Surcharge Fee
    service_fee:                      'fldE2fyJdEkgWKjV3', // SP Service Fee
    processing_fee:                   'fldaLp9k5z8PzsVWY', // SP Processing Fee
    transfer_fee:                     'flddESBzWveyNZoAb', // SP Transfer Fee
    transfer_requires_payment:        'fldn1kWf3hPquqvB3', // SP Transfer Requires Payment
    sales_organizer_revenue_amount:   'flduVzjcNslEIuQ6D', // SP Sales Organizer Revenue
    total_unlocked_by_count:          'fldnw1BbWoAvj54g2', // SP Total Unlocked By Count
    created_at:                       'fldPWHWknJKMTA9YM', // SP Created At
    updated_at:                       'fld5VspJQTFBkUos1', // SP Updated At
    // Nested fields
    promotion_code:                   'fldVK1bF3Rr6qHb78', // SP Promo Code
    'product.name':                   'fldoXm3rnAFIoScSG', // SP Product Name
    'product.type':                   'flddovxxZPt4ouaDJ', // SP Product Type
    'product.is_transfer_allowed':    'fldds1pR6g6xAk0EP', // SP Product Transfer Allowed
    invitation:                       'fldxynZkyHzP5TwXt', // SP Invitation
  },
};

// Field IDs that require special type coercion during mapping
export const COERCE_TO_STRING = new Set([
  'fld2Rv0GC8s9RxFKd', // SP Level (invitations) — SP returns number, Airtable field is singleLineText
]);

export const SP_BASE_URL = 'https://api.secretparty.io/secret';
