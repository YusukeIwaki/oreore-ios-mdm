require 'spec_helper'

RSpec.describe ManagedAppleAccount do
  describe 'email_local_part' do
    let(:account) { ManagedAppleAccount.new(email: 'test123@example.com') }

    it 'returns the local part of the email' do
      expect(account.email_local_part).to eq('test123')
    end
  end
end
