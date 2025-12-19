/* global BluetoothUUID */

export default class BleDevice {
  constructor(bluetoothApi, deviceOptions) {
    this.bluetoothApi = bluetoothApi;
    this.deviceOptions = deviceOptions;

    this.server = null;
    this.device = null;
  }

  isConnected() {
    return this.server && this.server.connected;
  }

  getDevice() {
    return this.bluetoothApi
      .requestDevice(this.deviceOptions)
      .then((device) => device.gatt.connect());
  }

  getGATTServer() {
    if (this.isConnected()) {
      return Promise.resolve(this.server);
    }

    return this.getDevice().then((server) => {
      this.server = server;

      return server;
    });
  }

  serviceCharacteristics(serviceUuid, characteristicResolvers) {
    const characteristicUuids = Object.keys(characteristicResolvers);

    return this.getGATTServer()
      .then((server) => server.getPrimaryService(serviceUuid))
      .then((service) => {
        return Promise.all(
          characteristicUuids.map(async (uuid) => {
            const characteristic = await service.getCharacteristic(uuid);
            const value = await characteristic.readValue();
            return { uuid, value };
          })
        );
      })
      .then((values) =>
        values.map((value) => ({
          uuid: value.uuid,
          value: characteristicResolvers[value.uuid](value.value),
        }))
      );
  }
}
