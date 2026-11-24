import Foundation
import Testing

@testable import NotesKit

@Suite struct GoogleSignInTests {
    let google = GoogleSignIn(clientId: "123-abc.apps.googleusercontent.com", verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", state: "s1")

    @Test func challengeIsTheVerifiersSHA256() {
        // RFC 7636 appendix B.
        #expect(google.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func answersComeBackToTheReversedClientId() {
        #expect(google.callbackScheme == "com.googleusercontent.apps.123-abc")
        let items = URLComponents(url: google.page, resolvingAgainstBaseURL: false)!.queryItems!
        let query = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        #expect(query["redirect_uri"] == "com.googleusercontent.apps.123-abc:/oauth2redirect")
        #expect(query["code_challenge_method"] == "S256")
        #expect(query["state"] == "s1")
        #expect(query["scope"] == "openid email profile")
    }

    @Test func takesTheCodeOnlyFromThisAttemptsAnswer() throws {
        #expect(try google.code(from: URL(string: "com.googleusercontent.apps.123-abc:/oauth2redirect?state=s1&code=4/xyz")!) == "4/xyz")
        #expect(throws: GoogleSignIn.Problem.failed) { try google.code(from: URL(string: "com.googleusercontent.apps.123-abc:/oauth2redirect?state=other&code=4/xyz")!) }
        #expect(throws: GoogleSignIn.Problem.cancelled) { try google.code(from: URL(string: "com.googleusercontent.apps.123-abc:/oauth2redirect?state=s1&error=access_denied")!) }
        #expect(throws: GoogleSignIn.Problem.failed) { try google.code(from: URL(string: "com.googleusercontent.apps.123-abc:/oauth2redirect?state=s1")!) }
    }

    @Test func tradesTheCodeWithTheVerifierAndNoSecret() {
        let body = String(decoding: google.tokenRequest(code: "4/a+b").httpBody!, as: UTF8.self)
        #expect(body.contains("code=4/a%2Bb"))
        #expect(body.contains("code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
        #expect(body.contains("grant_type=authorization_code"))
        #expect(!body.contains("secret"))
    }

    @Test func attemptsDiffer() {
        #expect(GoogleSignIn(clientId: "x").page != GoogleSignIn(clientId: "x").page)
    }
}
