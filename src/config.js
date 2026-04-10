// ============================================================
// CONFIGURATION
// ============================================================

export const BASES = {
  invitations: 'appgvcig9jwAhim6W',
  tickets: 'appgvcig9jwAhim6W',
  syncState: 'appgvcig9jwAhim6W',
};

export const TABLES = {
  invitations: 'tblKgwXnpqWjf8Z8q', // Invitations
  tickets: 'tblVGGdO9QrRYi50x',     // BSS'26
  syncState: 'tblT06K1k450mZ6q2',   // {{Sync State}}
};

// The Airtable field ID used to uniquely identify each SP record (upsert merge key)
export const MERGE_FIELDS = {
  invitations: 'fldFBesn9Xnq5TM3d', // SP ID
  tickets: 'fldq44PIoUKPDHh6m',     // SP ID
};

// Sync State table field IDs — used by airtable.js getCursor / logSync
export const SYNC_STATE_FIELDS = {
  endpoint:             'fldAo1psPukG3sQ1h', // Endpoint
  cursor:               'fldvBpePE7mnRrVDP', // Cursor
  triggeredBy:          'fldEItJaRgt9VPVK8', // Triggered By
  syncedAt:             'fld9aDm40gw6cBGnR', // Synced At
  status:               'fldWBdEoxTp6h8nfg', // Status
  error:                'fldLlLrqoEG6j4boI', // Error
  recordsFetched:       'fldRcckVEjGONXEaR', // Records Fetched
  invitationsCreated:   'fldGDBLEfUhqE75sW', // Invitations Created
  invitationsUpdated:   'fldjitUvHM6tSVwae', // Invitations Updated
  ticketsCreated:       'fldwWYgSXESA2KgCG', // Tickets Created
  ticketsUpdated:       'fldgkyq5nuTPsU7x3', // Tickets Updated
};

// Field mapping: Secret Party API field → Airtable field ID
// Nested fields use dot notation: 'product.name' → top-level product name string
export const FIELD_MAP = {
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
