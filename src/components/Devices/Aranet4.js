import React from "react";
import BleDevice from "../../ble-device";
import SensorValue from "../SensorValue";
import TimeAgo from "../TimeAgo";
import Chart from "chart.js/auto";

const decoder = new TextDecoder("utf-8"); // TODO: Add a polyfill for this.

const SENSOR_VALUES_CHARACTERISTIC_UUID = "f0cd1503-95da-4f4b-9ac8-aa55d312af0c";
const LAST_UPDATED_CHARACTERISTIC_UUID = "f0cd2004-95da-4f4b-9ac8-aa55d312af0c";
const UPDATE_INTERVAL_CHARACTERISTIC_UUID = "f0cd2002-95da-4f4b-9ac8-aa55d312af0c";
const HISTORY_COMMAND_CHARACTERISTIC_UUID = "f0cd1402-95da-4f4b-9ac8-aa55d312af0c";
const HISTORY_DATA_CHARACTERISTIC_UUID = "f0cd2005-95da-4f4b-9ac8-aa55d312af0c";

const aranetServices = {
  sensor: {
    serviceUuid: 0xFCE0,
    resolvers: {
      // Sensor values.
      [SENSOR_VALUES_CHARACTERISTIC_UUID]: (value) => {
        return {
          co2: value.getUint16(0, true),
          temperature: value.getUint16(2, true) / 20,
          pressure: value.getUint16(4, true) / 10,
          humidity: value.getUint8(6),
          battery: value.getUint8(7),
        };
      },
      // Seconds since the last sensor update.
      [LAST_UPDATED_CHARACTERISTIC_UUID]: (value) =>
        Math.floor(Date.now() / 1000) - value.getUint16(0, true),
      // Configured interval in seconds between the updates.
      [UPDATE_INTERVAL_CHARACTERISTIC_UUID]: (value) =>
        value.getUint16(0, true),
    },
  },
  device: {
    serviceUuid: "device_information",
    resolvers: {
      manufacturer_name_string: (value) => decoder.decode(value),
      model_number_string: (value) => decoder.decode(value),
      serial_number_string: (value) => decoder.decode(value),
      hardware_revision_string: (value) => decoder.decode(value),
      software_revision_string: (value) => decoder.decode(value),
    },
  },
};

const aranet4Device = new BleDevice(navigator.bluetooth, {
  filters: [
    { 
      services: [0xFCE0],
    },
  ],
  optionalServices: [0xFCE0, "device_information", "battery_service"],
});

export default class Aranet4 extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      connected: false,
      updateInterval: null,
      lastUpdated: null,
      error: null,
      sensorValues: {
        co2: null,
        temperature: null,
        pressure: null,
        humidity: null,
        battery: null,
      },
      sensorHistory: [],
      fetchingHistory: false,
      fetchTimeLeft: 0,
    };

    this.toggleConnection = this.toggleConnection.bind(this);
    this.downloadCSV = this.downloadCSV.bind(this);
    this.fetchDeviceHistory = this.fetchDeviceHistory.bind(this);
    this.chartRef = React.createRef();
    this.chart = null;
    this.fetchTimer = null;
  }

  componentDidMount() {
    this.updateChart();
  }

  componentDidUpdate() {
    this.updateChart();
  }

  componentWillUnmount() {
    if (this.chart) {
      this.chart.destroy();
    }
  }

  updateChart() {
    if (!this.chartRef.current) {
      return;
    }

    const ctx = this.chartRef.current.getContext("2d");

    if (this.state.sensorHistory.length === 0) {
      if (this.chart) {
        this.chart.destroy();
        this.chart = null;
      }
      return;
    }

    if (this.chart) {
      this.chart.data.labels = this.state.sensorHistory.map((entry) =>
        new Date(entry.timestamp).toLocaleTimeString()
      );
      this.chart.data.datasets[0].data = this.state.sensorHistory.map(
        (entry) => entry.co2
      );
      this.chart.data.datasets[1].data = this.state.sensorHistory.map(
        (entry) => entry.temperature
      );
      this.chart.data.datasets[2].data = this.state.sensorHistory.map(
        (entry) => entry.pressure
      );
      this.chart.data.datasets[3].data = this.state.sensorHistory.map(
        (entry) => entry.humidity
      );
      this.chart.update();
    } else {
      this.chart = new Chart(ctx, {
        type: "line",
        data: {
          labels: this.state.sensorHistory.map((entry) =>
            new Date(entry.timestamp).toLocaleTimeString()
          ),
          datasets: [
            {
              label: "CO2 (ppm)",
              data: this.state.sensorHistory.map((entry) => entry.co2),
              borderColor: "rgba(255, 99, 132, 1)",
              borderWidth: 1,
              fill: false,
            },
            {
              label: "Temperature (°C)",
              data: this.state.sensorHistory.map(
                (entry) => entry.temperature
              ),
              borderColor: "rgba(54, 162, 235, 1)",
              borderWidth: 1,
              fill: false,
            },
            {
              label: "Pressure (hPa)",
              data: this.state.sensorHistory.map(
                (entry) => entry.pressure
              ),
              borderColor: "rgba(255, 206, 86, 1)",
              borderWidth: 1,
              fill: false,
            },
            {
              label: "Humidity (%)",
              data: this.state.sensorHistory.map(
                (entry) => entry.humidity
              ),
              borderColor: "rgba(75, 192, 192, 1)",
              borderWidth: 1,
              fill: false,
            },
          ],
        },
        options: {
          scales: {
            x: {
              ticks: {
                autoSkip: true,
                maxTicksLimit: 10,
              },
            },
          },
        },
      });
    }
  }

  downloadCSV() {
    const header = "timestamp,co2,temperature,pressure,humidity,battery\n";
    const csv = this.state.sensorHistory
      .map((row) =>
        [
          row.timestamp,
          row.co2,
          row.temperature,
          row.pressure,
          row.humidity,
          row.battery,
        ].join(",")
      )
      .join("\n");

    const blob = new Blob([header + csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aranet4-history-${new Date().toISOString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async fetchDeviceHistory() {
    this.setState({
      fetchingHistory: true,
      fetchTimeLeft: 30,
      error: "Fetching history...",
    });

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
    }, 30000);

    this.fetchTimer = setInterval(() => {
      this.setState((prevState) => ({
        fetchTimeLeft: prevState.fetchTimeLeft - 1,
      }));
    }, 1000);

    try {
      const server = await aranet4Device.getGATTServer();
      const service = await server.getPrimaryService(0xfce0);
      const commandChar = await service.getCharacteristic(
        HISTORY_COMMAND_CHARACTERISTIC_UUID
      );
      const historyChar = await service.getCharacteristic(
        HISTORY_DATA_CHARACTERISTIC_UUID
      );
      const updateIntervalChar = await service.getCharacteristic(
        UPDATE_INTERVAL_CHARACTERISTIC_UUID
      );
      const lastUpdatedChar = await service.getCharacteristic(
        LAST_UPDATED_CHARACTERISTIC_UUID
      );

      const updateInterval = (await updateIntervalChar.readValue()).getUint16(
        0,
        true
      );
      const lastUpdated =
        Math.floor(Date.now() / 1000) -
        (await lastUpdatedChar.readValue()).getUint16(0, true);

      const parameters = {
        temperature: 2,
        humidity: 4,
        pressure: 3,
        co2: 1,
      };

      const historyData = {};
      let totalRecords = 0;

      for (const [param, paramId] of Object.entries(parameters)) {
        if (timedOut) break;
        historyData[param] = [];
        let startRecord = 1;
        const chunkSize = 100;

        while (!timedOut) {
          const command = new Uint8Array(5);
          const view = new DataView(command.buffer);
          view.setUint8(0, paramId);
          view.setUint16(1, startRecord, true);
          view.setUint16(3, chunkSize, true);
          await commandChar.writeValue(command);

          const data = await historyChar.readValue();
          if (data.byteLength === 0) {
            break;
          }

          const valueSize = param === "humidity" ? 1 : 2;
          for (let i = 0; i < data.byteLength; i += valueSize) {
            let value;
            if (valueSize === 1) {
              value = data.getUint8(i);
            } else {
              value = data.getUint16(i, true);
            }

            if (param === "temperature") {
              value /= 20;
            } else if (param === "pressure") {
              value /= 10;
            }
            historyData[param].push(value);
          }
          startRecord += chunkSize;
        }

        totalRecords = Math.max(totalRecords, historyData[param].length);
      }

      const sensorHistory = [];
      for (let i = 0; i < totalRecords; i++) {
        const timestamp = new Date(
          (lastUpdated - (totalRecords - 1 - i) * updateInterval) * 1000
        ).toISOString();
        sensorHistory.push({
          timestamp,
          co2: historyData.co2 && historyData.co2[i],
          temperature: historyData.temperature && historyData.temperature[i],
          pressure: historyData.pressure && historyData.pressure[i],
          humidity: historyData.humidity && historyData.humidity[i],
        });
      }

      this.setState({
        sensorHistory,
        error: timedOut ? "Fetching history timed out after 30 seconds. Displaying partial data." : null,
      });
    } catch (err) {
      this.setState({
        error: err.toString(),
      });
    } finally {
      clearTimeout(timeoutId);
      clearInterval(this.fetchTimer);
      this.setState({
        fetchingHistory: false,
        fetchTimeLeft: 0,
      });
    }
  }

  toggleConnection() {
    aranet4Device
      .serviceCharacteristics(
        aranetServices.sensor.serviceUuid,
        aranetServices.sensor.resolvers
      )
      .then((sensorReadings) => {
        const sensorValues = sensorReadings.find(
          (r) => r.uuid === SENSOR_VALUES_CHARACTERISTIC_UUID
        ).value;
        const lastUpdated = sensorReadings.find(
          (r) => r.uuid === LAST_UPDATED_CHARACTERISTIC_UUID
        ).value;
        const updateInterval = sensorReadings.find(
          (r) => r.uuid === UPDATE_INTERVAL_CHARACTERISTIC_UUID
        ).value;

        const newHistoryEntry = {
          timestamp: new Date().toISOString(),
          ...sensorValues,
        };

        this.setState((prevState) => ({
          error: null,
          connected: true,
          sensorValues: {
            co2: String(sensorValues.co2),
            temperature: String(sensorValues.temperature),
            pressure: String(sensorValues.pressure),
            humidity: String(sensorValues.humidity),
            battery: String(sensorValues.battery),
          },
          lastUpdated: new Date(lastUpdated * 1000),
          updateInterval: updateInterval,
          sensorHistory: [...prevState.sensorHistory, newHistoryEntry],
        }));
      })
      .catch((err) => {
        this.setState({
          error: err.toString(),
          connected: false,
        });
      });
  }

  render() {
    return (
      <div>
        <div className="card-header d-flex flex-row justify-content-between">
          <h3 className="flex-grow-1">
            Aranet4
            <a
              href="https://aranet4.com"
              className="btn btn-link btn-sm align-middle"
              title="Learn more about Aranet4"
            >
              Learn More
            </a>
          </h3>
          <input
            type="button"
            className="btn btn-primary"
            onClick={this.toggleConnection}
            value={this.state.connected ? "Refresh" : "Connect"}
          />
        </div>
        <div className="card-body">
          {this.state.error ? (
            <div className="alert alert-danger" role="alert">
              <code>{this.state.error}</code>
            </div>
          ) : null}
          {this.state.lastUpdated ? (
            <div className="alert alert-info" role="alert">
              Last updated <TimeAgo timestamp={this.state.lastUpdated} />{" "}
              (update interval set to {this.state.updateInterval} seconds).
            </div>
          ) : null}
          <table className="table table-borderless aranet-sensor-data">
            <tbody>
              <tr>
                <th>
                  CO<sub>2</sub>
                </th>
                <td>
                  <SensorValue
                    value={this.state.sensorValues.co2}
                    suffix="ppm"
                  />
                </td>
              </tr>
              <tr>
                <th>Temperature</th>
                <td>
                  <SensorValue
                    value={this.state.sensorValues.temperature}
                    suffix="°C"
                  />
                </td>
              </tr>
              <tr>
                <th>Pressure</th>
                <td>
                  <SensorValue
                    value={this.state.sensorValues.pressure}
                    suffix="hPa"
                  />
                </td>
              </tr>
              <tr>
                <th>Humidity</th>
                <td>
                  <SensorValue
                    value={this.state.sensorValues.humidity}
                    suffix="%"
                  />
                </td>
              </tr>
              <tr>
                <th>Battery</th>
                <td>
                  <SensorValue
                    value={this.state.sensorValues.battery}
                    suffix="%"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          {this.state.sensorHistory.length > 0 && (
            <div className="mt-3">
              <button
                className="btn btn-secondary"
                onClick={this.downloadCSV}
              >
                Save History as CSV
              </button>
              <button
                className="btn btn-secondary ms-2"
                onClick={this.fetchDeviceHistory}
                disabled={this.state.fetchingHistory}
              >
                {this.state.fetchingHistory
                  ? `Fetching... (${this.state.fetchTimeLeft}s left)`
                  : "Fetch History from Device"}
              </button>
            </div>
          )}
          <div className="mt-3">
            <canvas ref={this.chartRef}></canvas>
          </div>
        </div>
      </div>
    );
  }
}
