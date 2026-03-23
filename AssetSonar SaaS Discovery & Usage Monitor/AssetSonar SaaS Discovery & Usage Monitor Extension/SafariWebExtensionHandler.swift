//
//  SafariWebExtensionHandler.swift
//  AssetSonar SaaS Discovery & Usage Monitor Extension
//
//  Created by Haroon Rasheed on 23/03/2026.
//

import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private let defaultManagedValues: [String: Any] = [
        "CLOUD_SYNC": false,
        "TAG": "",
        "SUBDOMAIN": "",
        "REGION": ""
    ]

    private func configValue(for key: String) -> Any? {
        if let defaultsValue = UserDefaults.standard.object(forKey: key) {
            return defaultsValue
        }
        if let plistValue = Bundle.main.object(forInfoDictionaryKey: key) {
            return plistValue
        }
        return defaultManagedValues[key]
    }

    private func buildManagedConfigResponse(from payload: [String: Any]) -> [String: Any] {
        let requestedKeys = payload["keys"] as? [String] ?? []
        var values: [String: Any] = [:]

        for key in requestedKeys {
            if let value = configValue(for: key) {
                values[key] = value
            }
        }

        return [
            "values": values
        ]
    }

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let profile: UUID?
        if #available(iOS 17.0, macOS 14.0, *) {
            profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
        } else {
            profile = request?.userInfo?["profile"] as? UUID
        }

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        os_log(.default, "Received message from browser.runtime.sendNativeMessage: %@ (profile: %@)", String(describing: message), profile?.uuidString ?? "none")

        let response = NSExtensionItem()
        let responseMessage: [String: Any]
        if let payload = message as? [String: Any],
           let messageType = payload["type"] as? String,
           messageType == "getManagedConfig" {
            responseMessage = buildManagedConfigResponse(from: payload)
        } else {
            responseMessage = [ "echo": message as Any ]
        }

        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [ SFExtensionMessageKey: responseMessage ]
        } else {
            response.userInfo = [ "message": responseMessage ]
        }

        context.completeRequest(returningItems: [ response ], completionHandler: nil)
    }

}
