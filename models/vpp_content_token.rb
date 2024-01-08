class VppContentToken < ActiveRecord::Base
  def self.update_from(filename, ctoken)
    result = JSON.parse(Base64.strict_decode64(ctoken))
    # ref: https://developer.apple.com/documentation/devicemanagement/app_and_book_management/managing_apps_and_books_through_web_services
    # ------------------------------
    # token: A unique identifier for the organization’s location under management.
    # expDate: The expiration date of the token in ISO-8601 format.
    # orgName: The name of the organization for the issued token.

    record = find_or_initialize_by(filename: filename)
    record.update!(
      value: ctoken,
      exp_date: Time.parse(result['expDate']),
    )
    record
  end

  def url_encoded_filename
    ERB::Util.url_encode(filename)
  end
end
