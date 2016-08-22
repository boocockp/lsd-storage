const chai = require('chai')
const chaiSubset = require('chai-subset')
const PersistentStore = require('../../main/store/PersistentStore')
const PersistentStoreController = require('../../main/store/PersistentStoreController')
const LocalStorageUpdateStore = require('../../main/store/LocalStorageUpdateStore')
const AccessKeyCredentialsSource = require('../../main/store/AccessKeyCredentialsSource')
const S3UpdateStore = require('../../main/store/S3UpdateStore')
const {capture, captureFlat, waitFor} = require('../testutil/Helpers')
const {requireAWS} = require('../../main/util/Util')
const AWS = requireAWS()
const uuid = require('node-uuid')


chai.should()
chai.use(chaiSubset)

function testAction(name) {
    return {type: 'TEST', data: {name}}
}

function testActionWithId(name) {
    id = uuid.v4()
    return {id, type: 'TEST', data: {name}}
}

function update(actions) {
    return PersistentStoreController.newUpdate(actions)
}

describe("Persistent store", function () {
    this.timeout(50000)

    const testBucket = process.env.TEST_BUCKET
    const testAccessKey = process.env.TEST_ACCESS_KEY
    const testSecretKey = process.env.TEST_SECRET_KEY

    const [testAction1, testAction2, testAction3] = ["One", "Two", "Three"].map(testAction)
    const [savedAction1, savedAction2, savedAction3, savedAction4, savedAction5] = ["One", "Two", "Three", "Four", "Five"].map(testActionWithId)
    const [savedAction6, savedAction7, savedAction8, savedAction9, savedAction10] = ["Six", "Seven", "Eight", "Nine", "Ten"].map(testActionWithId)

    const updateA = update([savedAction1, savedAction2])
    const updateB = update([savedAction3])
    const updateC = update([savedAction4, savedAction5])

    const appName = "testapp"
    const dataSet = "testdata"
    const actionsKey = `${appName}.${dataSet}.actions`
    const updatesKey = `${appName}.${dataSet}.updates`
    let store, localStore, mockStorage, remoteStore, testS3Store

    function createPersistentStore() {
        localStore = new LocalStorageUpdateStore(appName, dataSet, mockStorage)
        store = new PersistentStore(localStore, remoteStore)
    }

    beforeEach("set up app", function () {
        mockStorage = new MockLocalStorage()

        const credentialsSource = new AccessKeyCredentialsSource(testAccessKey, testSecretKey)
        remoteStore = new S3UpdateStore(testBucket, 'updates', appName, dataSet, credentialsSource)

        testS3Store = new TestS3Store(testBucket, "updates", appName, dataSet)

    })

    describe("On startup", function () {

        beforeEach("set up s3 store", function () {
            return testS3Store.clearUpdates().then( () => testS3Store.storeUpdates(updateA, updateB, updateC) )
        })

        it("loads local updates, loads new remote updates, loads local actions, stores local actions in an update", function () {
            mockStorage.setData(updatesKey, [updateA])
            mockStorage.setData(actionsKey, [savedAction6, savedAction7])
            createPersistentStore()

            const externalActions = capture(store.externalAction)
            store.init()

            return waitFor(() => {
                // console.log( externalActions )
                return externalActions.length === 7
            }, 2000)
                .then(function () {
                    new Set(externalActions).should.eql(new Set([savedAction1, savedAction2, savedAction3, savedAction4, savedAction5, savedAction6, savedAction7]))
                })

                // .then(function () {
                //     return waitFor( s3Storage.getUpdates().then( (updates) => updates.length === 4 ))
                // })
        })
    })

    it("stores dispatched action locally if remote store not available", function () {
        store.dispatchAction(testAction1)
        mockStorage.getData(actionsKey).should.containSubset([testAction1])
    })
})

class MockLocalStorage {
    constructor() {
        this.items = new Map()
    }

    getItem(key) { return this.items.get(key)}
    setItem(key, value) { this.items.set(key, value)}

    getData(key) { return JSON.parse(this.getItem(key))}
    setData(key, value) { this.setItem(key, JSON.stringify(value)) }
}

class TestS3Store {
    constructor(bucketName, keyPrefix, appId, dataSet) {
        Object.assign(this, {bucketName, keyPrefix, appId, dataSet})
        this.s3 = new AWS.S3()
    }

    getUpdates() {
        const {s3, bucketName} = this

        function getUpdateKeys() {
            return s3.listObjectsV2({ Bucket: bucketName }).promise().then( listData => listData.Contents.map( x => x.Key ))
        }

        function getObjectBody(key) {
            return s3.getObjectBody({Key: key}).promise().then( data => data.Body )
        }

        function getObjectsForKeys(keys) {
            const promises = keys.map( getObjectBody )
            return Promise.all(promises)
        }

        function asUpdates(objectBodies) {
            return objectBodies.map( b => JSON.parse(b) )
        }

        return getUpdateKeys().then( getObjectsForKeys ).then( asUpdates ).catch( e => {console.error('Error getting updates', e); return []} )
    }

    clearUpdates() {
        const {s3, bucketName} = this

        function getUpdateKeys() {
            return s3.listObjectsV2({ Bucket: bucketName }).promise().then( listData => listData.Contents.map( x => x.Key ))
        }

        function deleteObjectsForKeys(keys) {
            const keysToDelete = keys.map( k => ({Key: k}) )

            const params = {
                Bucket: bucketName,
                Delete: {
                    Objects: keysToDelete,
                }
            };
            return s3.deleteObjects(params).promise()
        }

        return getUpdateKeys().then( deleteObjectsForKeys ).catch( e => {console.error('Error getting updates', e); return []} )
    }

    storeUpdate(update) {
        const prefix = this.keyPrefix ? this.keyPrefix + '/' : ''
        const key = prefix + this.appId + '/' + this.dataSet + '/' + update.id
        return this._storeInS3(key, JSON.stringify(update))
            .catch( e => console.error('Failed after sending update', e) )
    }

    storeUpdates(...updates) {
        const promises = updates.map(u => this.storeUpdate(u))
        return Promise.all(promises)
    }

    _storeInS3(key, objectContent) {
        const params = {
            Bucket: this.bucketName,
            Key: key,
            Body: objectContent
        }

        return this.s3.putObject(params).promise()
    }


}