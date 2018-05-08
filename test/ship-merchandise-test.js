'use strict';

const AdminConnection = require('composer-admin').AdminConnection;
const BusinessNetworkConnection = require('composer-client').BusinessNetworkConnection;
const { BusinessNetworkDefinition, CertificateUtil, IdCard } = require('composer-common');
const path = require('path');
const ModelFactory = require('./model-factory');
const Util = require('./util');

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
chai.should();


describe('Seller ships merchandise', () => {
    // In-memory card store for testing so cards are not persisted to the file system
    let adminConnection;
    let businessNetworkConnection;
    let adminCardName;

    // Test suite initial setup
    before(async () => {
        // Embedded connection used for local testing
        const connectionProfile = {
            name: 'embedded',
            'x-type': 'embedded'
        };
        // Generate certificates for use with the embedded connection
        const credentials = CertificateUtil.generate({ commonName: 'admin' });

        // PeerAdmin identity used with the admin connection to deploy business networks
        const deployerMetadata = {
            version: 1,
            userName: 'PeerAdmin',
            roles: [ 'PeerAdmin', 'ChannelAdmin' ]
        };
        const deployerCard = new IdCard(deployerMetadata, connectionProfile);
        deployerCard.setCredentials(credentials);

        const deployerCardName = 'PeerAdmin';
        adminConnection = new AdminConnection({ cardStore: Util.CARD_STORE });

        // TODO: Quickfix for https://github.com/hyperledger/composer/issues/3023
        if (!global.hasPeerAdminBeenAdded) {
            await adminConnection.importCard(deployerCardName, deployerCard);
            global.hasPeerAdminBeenAdded = true;
        }
       
        await adminConnection.connect(deployerCardName);
    });

    // This is called before each test is executed.
    beforeEach(async () => {
        businessNetworkConnection = new BusinessNetworkConnection({ cardStore: Util.CARD_STORE });

        const adminUserName = 'admin';
        let businessNetworkDefinition = await BusinessNetworkDefinition.fromDirectory(path.resolve(__dirname, '..'));

        // Install the Composer runtime for the new business network
        await adminConnection.install(businessNetworkDefinition);

        // Start the business network and configure an network admin identity
        const startOptions = {
            networkAdmins: [
                {
                    userName: adminUserName,
                    enrollmentSecret: 'adminpw'
                }
            ]
        };
        const adminCards = await adminConnection.start(businessNetworkDefinition.getName(), businessNetworkDefinition.getVersion(), startOptions);

        // Import the network admin identity for us to use
        adminCardName = `${adminUserName}@${businessNetworkDefinition.getName()}`;
        await adminConnection.importCard(adminCardName, adminCards.get(adminUserName));

        // Connect to the business network using the network admin identity
        await businessNetworkConnection.connect(adminCardName);

        await Util.createTestTraders(businessNetworkConnection, adminConnection);
    });

    it('the trader is not the seller of the trade', async () => {
        const factory = businessNetworkConnection.getBusinessNetwork().getFactory();

        businessNetworkConnection = await Util.connectAsAdmin(businessNetworkConnection, adminCardName);

        // create trade
        let buyer = Util.getTrader(1);
        let seller = Util.getTrader(2);
        const trade = ModelFactory.createTrade(factory, '1', buyer.id, seller.id, true, 'STEP_1_WAITING_FOR_TERMS_AGREEMENT');
        const tradeRegistry = await Util.getTradeRegistry(businessNetworkConnection);
        await tradeRegistry.add(trade);

        businessNetworkConnection = await Util.connectAsTrader(1, businessNetworkConnection);

        // shipping transaction
        businessNetworkConnection = await Util.connectAsTrader(0, businessNetworkConnection);
        const shipping = ModelFactory.createTransaction(factory, ModelFactory.TYPE.SHIP_MERCHANDISE);
        shipping.trade = ModelFactory.createRelationshipForTrade(factory, trade.id);
        await businessNetworkConnection.submitTransaction(shipping).should.be.rejectedWith(Error);
    });

    it('the trade cannot be shipped', async () => {
        const factory = businessNetworkConnection.getBusinessNetwork().getFactory();

        businessNetworkConnection = await Util.connectAsAdmin(businessNetworkConnection, adminCardName);

        // create trade
        let buyer = Util.getTrader(1);
        let seller = Util.getTrader(2);
        const trade = ModelFactory.createTrade(factory, '1', buyer.id, seller.id, true, 'STEP_1_WAITING_FOR_TERMS_AGREEMENT');
        const tradeRegistry = await Util.getTradeRegistry(businessNetworkConnection);
        await tradeRegistry.add(trade);

        businessNetworkConnection = await Util.connectAsTrader(2, businessNetworkConnection);

        // shipping transaction
        const shipping = ModelFactory.createTransaction(factory, ModelFactory.TYPE.SHIP_MERCHANDISE);
        shipping.trade = ModelFactory.createRelationshipForTrade(factory, trade.id);
        await businessNetworkConnection.submitTransaction(shipping).should.be.rejectedWith(Error);
    });

    it('the seller ships the merchandise', async () => {
        const factory = businessNetworkConnection.getBusinessNetwork().getFactory();

        businessNetworkConnection = await Util.connectAsAdmin(businessNetworkConnection, adminCardName);

        // create trade
        let buyer = Util.getTrader(1);
        let seller = Util.getTrader(2);
        let trade = ModelFactory.createTrade(factory, '1', buyer.id, seller.id, true, 'STEP_3_BUYER_MOVED_FUNDS_TO_ESCROW');
        const tradeRegistry = await Util.getTradeRegistry(businessNetworkConnection);
        await tradeRegistry.add(trade);

        businessNetworkConnection = await Util.connectAsTrader(2, businessNetworkConnection);

        // shipping transaction
        const shipping = ModelFactory.createTransaction(factory, ModelFactory.TYPE.SHIP_MERCHANDISE);
        shipping.trade = ModelFactory.createRelationshipForTrade(factory, trade.id);
        await businessNetworkConnection.submitTransaction(shipping);

        // check the state of the trade
        trade = await tradeRegistry.get(trade.id);
        trade.status.should.equal('STEP_4_MERCHANDISE_IS_SHIPPED');
    });
});
