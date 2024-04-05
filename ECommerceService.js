const R = require('ramda');
const ProfileService = require('./ProfileService');
const BigCommerceCustomers = require('../utils/bigCommerce/customers');
const BigCommerceCarts = require('../utils/bigCommerce/carts');
const BigCommerceOrders = require('../utils/bigCommerce/orders');
const { CART_MAIN, CART_PAY_LATER } = require('../constants');
// ************* Initialize ECommerce *************/

const getOrCreateCartAndUpdateProfile = async (
  profile,
  cartId,
  cartType = CART_MAIN
) => {
  const { bigCommerceCustomerId, profileId } = profile;
  let cart;
  if (cartId) {
    cart = await BigCommerceCarts.getCart(cartId);
  }
  if (!cart) {
    // create one and update the profile
    cart = await BigCommerceCarts.createCart(bigCommerceCustomerId);
    await ProfileService.setProfileCartId(profileId, cart.id, cartType);
  }
  return cart;
};

const updateProfileIfNeeded = async (
  profile,
  cart,
  newBigCommerceCustomerId,
  newBigCommerceCartId
) => {
  const { bigCommerceCustomerId, bigCommerceCartId, profileId } = profile;

  if (R.isNil(bigCommerceCustomerId) || R.isEmpty(bigCommerceCustomerId)) {
    await ProfileService.setProfileBcCustomerId(
      profileId,
      newBigCommerceCustomerId
    );
  }
  if (
    R.isNil(bigCommerceCartId) &&
    !R.isEmpty(cart) &&
    cart.id !== bigCommerceCartId
  ) {
    await ProfileService.setProfileCartId(profileId, newBigCommerceCartId);
  }
};

const getOrInitializeECommerce = async (profile) => {
  const { bigCommerceCartId } = profile;
  let { bigCommerceCustomerId } = profile;
  let bcCustomer;
  if (!bigCommerceCustomerId) {
    // see if email exists in BC
    bcCustomer = await BigCommerceCustomers.getCustomerByEmail(profile.email);
    bigCommerceCustomerId = bcCustomer && bcCustomer.id;
  }
  if (!bigCommerceCustomerId) {
    bcCustomer = await BigCommerceCustomers.createCustomer(profile);
    bigCommerceCustomerId = bcCustomer.id;
  }
  const cart = await getOrCreateCartAndUpdateProfile(
    profile,
    bigCommerceCartId
  );

  await updateProfileIfNeeded(profile, cart, bigCommerceCustomerId, cart.id);
  return cart;
};

// ************* Cart API *************/

const getOrCreateECommerceCartByProfileId = async (
  profileId,
  cartType = CART_MAIN
) => {
  const profile = await ProfileService.getCaregiverProfile(profileId);
  if (!profile) {
    throw new Error('Profile could not be found');
  }
  const cart = await getOrInitializeECommerce(profile);
  const { bigCommercePayLaterCartId } = profile;
  if (cartType === CART_PAY_LATER) {
    return getOrCreateCartAndUpdateProfile(
      profile,
      bigCommercePayLaterCartId,
      CART_PAY_LATER
    );
  }
  return cart;
};

const getOrCreateECommerceMainCart = async (profileId) => {
  return getOrCreateECommerceCartByProfileId(profileId, CART_MAIN);
};

const getOrCreateECommercePayLaterCart = async (profileId) => {
  return getOrCreateECommerceCartByProfileId(profileId, CART_PAY_LATER);
};
const addItemsToECommerceCart = async (cartId, items) => {
  return BigCommerceCarts.addItemsToCart(cartId, items);
};

const deleteItemsFromECommerceCart = async (cartId, itemIds) => {
  let updatedCart;
  if (!(itemIds instanceof Array)) {
    throw new Error('itemIds should be an array');
  }
  if (itemIds.length === 1) {
    await BigCommerceCarts.deleteItemFromCart(cartId, itemIds[0]);
    updatedCart = await BigCommerceCarts.getCart(cartId);
  } else {
    await Promise.all(
      itemIds.map(async (itemId) =>
        BigCommerceCarts.deleteItemFromCart(cartId, itemId)
      )
    );
    updatedCart = await BigCommerceCarts.getCart(cartId);
  }
  return updatedCart;
};

const createECommerceCartRedirectUrls = async (cartId) => {
  return BigCommerceCarts.createCartRedirectUrls(cartId);
};

const createLoggedInCartRedirectUrls = async (cartId, profileId) => {
  return BigCommerceCarts.createLoggedInCartRedirectUrls(cartId, profileId);
};

const findItemInCartById = (cart, itemId) => {
  const cartItems = [
    ...R.pathOr([], ['line_items', 'custom_items'], cart),
    ...R.pathOr([], ['line_items', 'physical_items'], cart),
  ];
  return cartItems.find((cartItem) => cartItem.id === itemId);
};

const findItemInCartBySku = (cart, itemSku) => {
  const cartItems = [
    ...R.pathOr([], ['line_items', 'custom_items'], cart),
    ...R.pathOr([], ['line_items', 'physical_items'], cart),
  ];
  return cartItems.find((cartItem) => cartItem.sku === itemSku);
};

const moveItemToCart = async (
  profileId,
  sourceCart,
  itemId,
  destinationCart
) => {
  const profile = await ProfileService.getCaregiverProfile(profileId);
  if (!profile) {
    throw new Error('Profile could not be found');
  }

  const itemInCart = findItemInCartById(sourceCart, itemId);
  if (!itemInCart) {
    throw new Error('Item not found in the source cart');
  }
  const isOtc = Boolean(itemInCart.product_id);
  const newItem = isOtc
    ? R.pick(['variant_id', 'product_id', 'list_price', 'quantity'], itemInCart)
    : R.pick(['name', 'sku', 'list_price', 'quantity'], itemInCart);

  const newSourceCart = await deleteItemsFromECommerceCart(sourceCart.id, [
    itemId,
  ]);
  const newDestCart = await addItemsToECommerceCart(destinationCart.id, {
    [isOtc ? 'otcItems' : 'prescriptionItems']: [newItem],
  });

  // the new location cart
  return {
    sourceCart: newSourceCart,
    destinationCart: newDestCart,
  };
};

const moveItemToMainCart = async (profileId, itemId) => {
  const sourceCart = await getOrCreateECommercePayLaterCart(profileId);
  const destinationCart = await getOrCreateECommerceMainCart(profileId);

  const result = await moveItemToCart(
    profileId,
    sourceCart,
    itemId,
    destinationCart
  );
  return {
    sourceCartLocation: CART_PAY_LATER,
    destinationCartLocation: CART_MAIN,
    ...result,
  };
};

const moveItemToPayLaterCart = async (profileId, itemId) => {
  const sourceCart = await getOrCreateECommerceMainCart(profileId);
  const destinationCart = await getOrCreateECommercePayLaterCart(profileId);

  const result = await moveItemToCart(
    profileId,
    sourceCart,
    itemId,
    destinationCart
  );
  return {
    sourceCartLocation: CART_MAIN,
    destinationCartLocation: CART_PAY_LATER,
    ...result,
  };
};

// ************* Order API ***************/
const getECommerceOrders = async (profileId) => {
  const { bigCommerceCustomerId } =
    (await ProfileService.getCaregiverProfile(profileId)) || {};
  if (!bigCommerceCustomerId) {
    throw new Error(
      'Error Profile could not be found or missing bigCommerceCustomerId'
    );
  }
  return BigCommerceOrders.getOrders(bigCommerceCustomerId);
};

const getECommerceOrderShippingAddresses = async (orderId) => {
  return BigCommerceOrders.getOrderAddresses(orderId);
};

const getEcommerceOrderShipments = async (orderId) =>
  BigCommerceOrders.getOrderShipments(orderId);

const getECommerceOrderProducts = async (orderId) => {
  return BigCommerceOrders.getOrderProducts(orderId);
};

const getECommerceOrderById = async (orderId) => {
  return BigCommerceOrders.getOrderById(orderId);
};
const addShippingAddress = async (
  cart,
  address,
  email,
  firstName,
  lastName
) => {
  return BigCommerceCarts.addShippingAddress(
    cart,
    address,
    email,
    firstName,
    lastName
  );
};
const createConsignment = async (cart, consignmentId, shippingCostTotal) => {
  BigCommerceCarts.createConsignment(cart);
};
const setShippingCost = async (cart, consignmentId, shippingCostTotal) => {
  BigCommerceCarts.setShippingCost(cart, consignmentId, shippingCostTotal);
};
const getFreeshippingCoupon = async () => {
  return BigCommerceCarts.getFreeshippingCoupon();
};
const addCoupon = async (cart, code) => {
  return BigCommerceCarts.addCoupon(cart, code);
};
const removeCoupon = async (cart, code) => {
  return BigCommerceCarts.removeCoupon(cart, code);
};
module.exports = {
  Cart: {
    cartTypes: {
      CART_MAIN,
      CART_PAY_LATER,
    },
    getOrCreateECommerceCartByProfileId,
    getOrCreateECommerceMainCart,
    getOrCreateECommercePayLaterCart,
    addItemsToECommerceCart,
    deleteItemsFromECommerceCart,
    createECommerceCartRedirectUrls,
    findItemInCartById,
    findItemInCartBySku,
    moveItemToMainCart,
    moveItemToPayLaterCart,
    createLoggedInCartRedirectUrls,
    addShippingAddress,
    createConsignment,
    setShippingCost,
    getFreeshippingCoupon,
    addCoupon,
    removeCoupon,
  },
  Order: {
    getECommerceOrderShippingAddresses,
    getECommerceOrderProducts,
    getECommerceOrders,
    getECommerceOrderById,
    getEcommerceOrderShipments,
  },
};
