require 'spec_helper'

RSpec.describe VppContentToken do
  before do
    VppContentToken.delete_all
  end

  let(:example_token) {
    # example token value is described here https://developer.apple.com/documentation/devicemanagement/app_and_book_management/managing_apps_and_books_through_web_services
    'ewogICAgInRva2VuIjogIlZGZHdRbVZWTVZSUldGSktVbGRTTlZkc1pHcGpNR3hIVTI1Q2FrMXRhRzlhUjJ3eldqRkdkVk50ZUd0VFJrWjZVMVZhVDJGSFRuUlNiVGxOVVRCS1ExcEdhRTlOUjBaWVRrUXdQUT09IiwKICAgICJleHBEYXRlIjogIjIwMzAtMTEtMDhUMjI6MzM6MjIrMDAwMCIsCiAgICAib3JnTmFtZSI6ICJPUkcxMjM0NSIKfQ=='
  }

  it 'should create from raw content token' do
    expect {
      VppContentToken.update_from('apple_example.vpptoken', example_token)
    }.to change { VppContentToken.count }.by(1)
    content_token = VppContentToken.last
    expect(content_token.value).to eq(example_token)

    expect(content_token.exp_date).to eq(Time.parse('2030-11-08T22:33:22+0000'))
  end

  it 'should update from raw content token' do
    content_token = VppContentToken.update_from(
      'apple_example.vpptoken',
      Base64.strict_encode64({
        token: '2021 - Greg, Rishav, Brett, Sarah, Austin/',
        expDate: Time.parse('2024-01-01T12:34:56+0000'),
        orgName: 'ORG12345',
      }.to_json),
    )
    VppContentToken.update_from('apple_example.vpptoken', example_token)

    expect {
      VppContentToken.update_from('apple_example.vpptoken', example_token)
    }.not_to change { VppContentToken.count }
    content_token.reload
    expect(content_token.value).to eq(example_token)
    expect(content_token.exp_date).to eq(Time.parse('2030-11-08T22:33:22+0000'))
  end
end
