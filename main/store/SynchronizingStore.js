const {ObservableValue, ObservableEvent} = require('lsd-observable')

class SynchronizingStore {

    constructor(initialState) {
        this.state = new ObservableValue(initialState)
        this.dispatches = new ObservableEvent()

        this._updateState = this._updateState.bind(this)
        this.applyAction = this.applyAction.bind(this)
    }

    get appState() {
        return this.state.value
    }

    updateAndSave(methodName, ...args) {
        this._updateState(methodName, args)
        if (args.length > 1) {
            throw new Error("Cannot handle multiple arguments yet: " + args)        // TODO  handle multiple arguments
        }
        this.dispatches.send({type: methodName, data: args[0]})
    }

    _updateState(methodName, args) {
        const currentState = this.state.value
        const updateFunction = currentState[methodName]
        if (typeof updateFunction !== 'function')  {
            console.error( `Method ${methodName} not found on ${currentState}`)
            return
        }
        this.state.value = updateFunction.apply(currentState, args)
    }

    applySnapshot() {
    }

    applyAction(action) {
        this._updateState(action.type, [action.data])
    }

}

module.exports = SynchronizingStore
