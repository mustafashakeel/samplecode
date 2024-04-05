import axios from 'axios'
import { merge, isEmpty } from 'lodash'
import { API_ROOT } from '../apiConfig'
import { removeMFAConfirmedAdmin } from './AdminService'
import AuthService from './AuthService'
import {
  Constants,
  DEFAULT_SERVER_ERR_MSG,
  STORAGE_PREFIX,
  TTL,
} from './Constants'
function authDecorator(decorated) {
  return async function () {
    const user = await AuthService.getLoggedInUser()
    const loginTime = localStorage.getItem(`${STORAGE_PREFIX}${user?.username}`)
    if (loginTime && Date.now() - loginTime < TTL) {
      const result = decorated.apply(this, arguments).catch((error) => {
        if (error.response?.status === 401) {
          localStorage.removeItem(`${STORAGE_PREFIX}${user?.username}`)
          AuthService.signOut()
          window.location = Constants.ScreenPaths.LOGIN
        } else {
          throw error
        }
      })
      return result
    } else {
      localStorage.removeItem(`${STORAGE_PREFIX}${user?.username}`)
      removeMFAConfirmedAdmin(user?.username)
      await AuthService.signOut()
      window.location = Constants.ScreenPaths.LOGIN 
    }
  }
}
const configuration = {
  baseURL: API_ROOT,
  headers: {},
  timeout: 30000,
}
const createConfig = async () => {
  const jwt = await AuthService.retrieveAccessToken()
  const idJwt = await AuthService.retrieveIdToken()
  return merge({}, configuration, {
    headers: { jwtaccesstoken: jwt, jwtidtoken: idJwt },
  })
}

const path = {
  pharmacist: 'pharmacist',
  orders: 'orders',
  prescription: 'prescription',
  profiles: 'profiles',
  health: 'health',
  search: 'search',
  user: 'user',
  documents: 'documents',
  medications: 'medications',
  reminder: 'reminders',
  reports: 'reports',
}

class PharmacistServiceClass {
  constructor() {
    this.getPharmacist = authDecorator(this.getPharmacist)
    this.serchPatient = authDecorator(this.serchPatient)
    this.createOrder = authDecorator(this.createOrder)
    this.update = authDecorator(this.update)
    this.getOrder = authDecorator(this.getOrder)
    this.saveMedications = authDecorator(this.saveMedications)
    this.updateOrder = authDecorator(this.updateOrder)
    this.updatePrescription = authDecorator(this.updatePrescription)
    this.getOrders = authDecorator(this.getOrders)
    this.createPatient = authDecorator(this.createPatient)
    this.updateReminder = authDecorator(this.updateReminder)
    this.getMedicationReminder = authDecorator(this.getMedicationReminder)
    this.getCRMReprot = authDecorator(this.getCRMReprot)
  }
  async getPharmacist() {
    const config = await createConfig()
    const response = await axios.get([path.pharmacist].join('/'), config)
    return response.data
  }
  async serchPatient(term) {
    const config = await createConfig()
    const response = await axios.get(
      `${[path.pharmacist, path.profiles, path.search].join('/')}?q=${term}`,
      config
    )
    return response.data
  }

  async createOrder(profileId) {
    const config = await createConfig()
    const response = await axios.post(
      `${[path.pharmacist, path.prescription].join('/')}`,
      { profileId: profileId },
      merge({}, config, {
        headers: {
          'content-type': 'application/json',
        },
      })
    )
    return response.data
  }
  async update({
    firstName,
    lastName,
    email,
    phoneNumber,
    locationName,
    fax,
    address1,
    address2,
    city,
    province,
    country,
    zip,
  }) {
    const address = Object.fromEntries(
      Object.entries({
        addressLine1: address1,
        addressLine2: address2,
        city: city,
        province: province,
        postalCode: zip,
      }).filter(([k, v]) => !!v)
    )
    const pharmacy = Object.fromEntries(
      Object.entries({
        locationName: locationName,
        fax: fax,
        address: Object.values(address).length > 0 ? address : null,
      }).filter(([k, v]) => !!v)
    )
    const data = Object.fromEntries(
      Object.entries({
        firstname: firstName,
        lastname: lastName,
        email: email,
        phoneNumber: phoneNumber,
        pharmacy: Object.values(pharmacy).length > 0 ? pharmacy : null,
      }).filter(([k, v]) => !!v)
    )
    const config = await createConfig()
    try {
      const response = await axios.put(
        [path.pharmacist].join('/'),
        data,
        merge({}, config, {
          headers: {
            'content-type': 'application/json',
          },
        })
      )
      return response
    } catch (error) {
      //TODO: Mocking data
      return {}
    }
  }

  async getOrder(orderId) {
    const config = await createConfig()
    return axios.get([path.pharmacist, path.orders, orderId].join('/'), config)
  }

  async getCRMReprot() {
    const config = await createConfig()
    const response = await axios.get(
      `${[path.pharmacist, path.reports, 'CRM'].join('/')}`,
      config
    )
    return response.data
  }

  async saveMedications(values, prescriptionId) {
    const config = await createConfig()
    return axios.put(
      [path.pharmacist, path.prescription, prescriptionId].join('/'),
      values,
      merge({}, config, {
        headers: {
          'content-type': 'application/json',
        },
      })
    )
  }

  async updateOrder(values, orderId) {
    const config = await createConfig()
    return axios.put(
      [path.pharmacist, path.orders, orderId].join('/'),
      values,
      merge({}, config, {
        headers: {
          'content-type': 'application/json',
        },
      })
    )
  }
  async updatePrescription(values, prescriptionId) {
    const config = await createConfig()
    return axios.put(
      [path.pharmacist, path.prescription, prescriptionId].join('/'),
      values,
      merge({}, config, {
        headers: {
          'content-type': 'application/json',
        },
      })
    )
  }
  async getOrders(count = 10000) {
    const config = await createConfig()
    const response = await axios.get(
      `${[path.pharmacist, path.orders].join('/')}?count=${count}`,
      merge({}, config, {
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
      })
    )
    return response.data
  }
  async createPatient(values) {
    const config = await createConfig()
    return await axios
      .post(
        [path.pharmacist, path.user].join('/'),
        values,
        merge({}, config, {
          headers: {
            'content-type': 'application/json',
          },
        })
      )
      .catch((error) => {
        if (error.response?.status === 409) {
          throw new Error(error.response.data?.error || DEFAULT_SERVER_ERR_MSG)
        }
        throw error
      })
  }
  async updateReminder(values, patientProfileId) {
    const config = await createConfig()
    return axios.put(
      [path.pharmacist, path.profiles, patientProfileId].join('/'),
      values,
      merge({}, config, {
        headers: {
          'content-type': 'application/json',
        },
      })
    )
  }

  async getMedicationReminder(medicationId) {
    const config = await createConfig()
    const response = await axios.get(
      [path.pharmacist, path.medications, medicationId, path.reminder].join(
        '/'
      ),
      merge({}, config, {
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
      })
    )
    return response.data
  }

  async createMedicationReminder(medicationId, type, values) {
    const config = await createConfig()
    const response = await axios.post(
      [
        path.pharmacist,
        path.medications,
        medicationId,
        path.reminder,
        type,
      ].join('/'),
      values,
      merge({}, config, {
        headers: {
          'content-type': 'application/json',
        },
      })
    )
    return response.data
  }
  async updateMedicationReminder(medicationId, values) {
    const { type } = values
    const config = await createConfig()
    const response = axios.put(
      [
        path.pharmacist,
        path.medications,
        medicationId,
        path.reminder,
        type,
      ].join('/'),
      values,
      merge({}, config, {
        headers: {
          'content-type': 'application/json',
        },
      })
    )
    return response.data
  }
  async deleteMedicationReminder(medicationId, type) {
    const config = await createConfig()
    const response = await axios.delete(
      [
        path.pharmacist,
        path.medications,
        medicationId,
        path.reminder,
        type,
      ].join('/'),
      merge({}, config, {
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
      })
    )
    return response.data
  }
}

export const pharmacistUploadFile = authDecorator(async (file) => {
  const formData = new FormData()
  formData.append('fileName', file)
  const config = await createConfig()
  return axios.post(
    [path.pharmacist, 'docUpload'].join('/'),
    formData,
    merge({}, config, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  )
})

export const PharmacistDocumentService = {
  post: authDecorator(
    async (
      document: {
        fileName: string,
        side: 'front' | 'back',
        type:
          | 'provincialHealthCard'
          | 'governmentId'
          | 'InsuranceProvider-Primary'
          | 'InsuranceProvider-Secondary'
          | 'InsuranceProvider-Tertiary'
          | 'additional',
      },
      profileId
    ) => {
      const config = await createConfig()
      const response = await axios.post(
        [path.pharmacist, path.profiles, profileId, path.documents].join('/'),
        document,
        merge({}, config, {
          headers: {
            'content-type': 'application/json',
          },
        })
      )
      return response.data
    }
  ),
  put: authDecorator(
    async (
      documentId,
      document: {
        fileName: string,
        side: 'front' | 'back',
        type:
          | 'provincialHealthCard'
          | 'governmentId'
          | 'InsuranceProvider-Primary'
          | 'InsuranceProvider-Secondary'
          | 'InsuranceProvider-Tertiary'
          | 'additional',
      },
      profileId
    ) => {
      const config = await createConfig()
      const response = await axios.put(
        [
          path.pharmacist,
          path.profiles,
          profileId,
          path.documents,
          documentId,
        ].join('/'),
        document,
        merge({}, config, {
          headers: {
            'content-type': 'application/json',
          },
          baseURL: API_ROOT,
        })
      )
      return response.data
    }
  ),
  list: authDecorator(async (profileId) => {
    let config = await createConfig()
    const response = await axios.get(
      [path.pharmacist, path.profiles, profileId, path.documents].join('/'),
      config
    )
    return response.data
  }),
}
const PharmacistService = new PharmacistServiceClass()
export const PharmacistSHealthService = {
  splitter: '\n',
  put: authDecorator(
    async (
      currentMedications: [string],
      pastMedications: [string],
      allergies: [string],
      profileId
    ): {
      healthId: string,
      patientId: string,
      currentMedications: [string],
      pastMedications: [string],
      allergies: [string],
    } => {
      const config = await createConfig()
      const response = await axios.put(
        [path.pharmacist, path.profiles, profileId, path.health].join('/'),
        {
          currentMedications: currentMedications.join(
            PharmacistSHealthService.splitter
          ),
          pastMedications: pastMedications.join(
            PharmacistSHealthService.splitter
          ),
          allergies: allergies.join(PharmacistSHealthService.splitter),
        },
        merge({}, config, {
          headers: {
            'content-type': 'application/json',
          },
        })
      )
      return response.data
    }
  ),
  post: authDecorator(
    async (
      currentMedications: [string],
      pastMedications: [string],
      allergies: [string],
      profileId
    ): {
      healthId: string,
      patientId: string,
      currentMedications: [string],
      pastMedications: [string],
      allergies: [string],
    } => {
      const config = await createConfig()
      const response = await axios.post(
        [path.pharmacist, path.profiles, profileId, path.health].join('/'),
        {
          currentMedications: currentMedications
            .filter((item) => item.trim().length > 0)
            .join(PharmacistSHealthService.splitter),
          pastMedications: pastMedications
            .filter((item) => item.trim().length > 0)
            .join(PharmacistSHealthService.splitter),
          allergies: allergies
            .filter((item) => item.trim().length > 0)
            .join(PharmacistSHealthService.splitter),
        },
        merge({}, config, {
          headers: {
            'content-type': 'application/json',
          },
        })
      )
      return response.data
    }
  ),
  get: authDecorator(async (profileId): {
    healthId: string,
    patientId: string,
    currentMedications: [string],
    pastMedications: [string],
    allergies: [string],
  } => {
    let config = await createConfig()
    const response = await axios.get(
      [path.pharmacist, path.profiles, profileId, path.health].join('/'),
      config
    )
    const result = response.data
    return !isEmpty(result)
      ? {
          currentMedications:
            result?.currentMedications
              ?.split(PharmacistSHealthService.splitter)
              .filter((item) => item.trim().length > 0) || [],
          pastMedications:
            result?.pastMedications
              ?.split(PharmacistSHealthService.splitter)
              .filter((item) => item.trim().length > 0) || [],
          allergies:
            result?.allergies
              ?.split(PharmacistSHealthService.splitter)
              .filter((item) => item.trim().length > 0) || [],
        }
      : result
  }),
}
export { PharmacistService }
