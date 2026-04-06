import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

export class StartSessionDto {
	@IsString()
	@MinLength(2)
	@MaxLength(120)
	fullName!: string;

	@IsString()
	@MinLength(2)
	@MaxLength(120)
	congregation!: string;

	@IsString()
	@MinLength(2)
	@MaxLength(160)
	schoolName!: string;

	@IsBoolean()
	agreedToTerms!: boolean;
}
