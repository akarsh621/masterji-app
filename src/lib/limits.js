// Sanity limits shared by the billing screen and the server. A budget shop
// never sells a single piece above this, so a bigger MRP is a typing slip.
export const MAX_MRP = 25000;
export const MAX_QTY_PER_LINE = 100;
// How long a salesman can Edit or Cancel their own bill after saving it.
export const SALESMAN_CHANGE_MINUTES = 60;
